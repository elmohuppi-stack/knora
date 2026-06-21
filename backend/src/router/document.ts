import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { authMiddleware } from "../middleware/auth.ts";
import * as documentService from "../service/document.ts";

const documentRouter = new Hono();
documentRouter.use("*", authMiddleware);

const urlSchema = z.object({
  workspace_id: z.string().uuid(),
  url: z.string().url(),
  title: z.string().optional(),
});

// Dokumente eines Workspace auflisten
documentRouter.get("/:workspaceId", async (c) => {
  const workspaceId = c.req.param("workspaceId");
  const list = await documentService.listDocuments(workspaceId);
  return c.json({ documents: list });
});

// Einzelnes Dokument abrufen
documentRouter.get("/detail/:id", async (c) => {
  const id = c.req.param("id");
  const doc = await documentService.getDocument(id);
  if (!doc) return c.json({ error: "Document not found" }, 404);
  return c.json({ document: doc });
});

// Datei-Upload
documentRouter.post("/upload/:workspaceId", async (c) => {
  const workspaceId = c.req.param("workspaceId");
  const user = c.get("user");

  const body = await c.req.parseBody();
  const file = body["file"] as File | undefined;

  if (!file) {
    return c.json({ error: "No file provided" }, 400);
  }

  const fileName = file.name || "unnamed";
  const fileType = fileName.split(".").pop()?.toLowerCase() || "txt";
  const fileSize = file.size;

  // Erlaubte Typen
  const allowedTypes = ["pdf", "docx", "md", "txt", "html", "csv"];
  if (!allowedTypes.includes(fileType)) {
    return c.json(
      {
        error: `File type .${fileType} not supported. Allowed: ${allowedTypes.join(", ")}`,
      },
      400,
    );
  }

  // Dokument in DB anlegen
  const doc = await documentService.createDocument({
    id: crypto.randomUUID(),
    workspace_id: workspaceId,
    title: fileName,
    type: fileType,
    source: fileName,
    file_size: fileSize,
    created_by: user.id,
    content: null,
  });

  // Text im Request-Kontext lesen (File ist nur hier gültig)
  let fileContent: string | null = null;
  try {
    if (fileType === "txt" || fileType === "md" || fileType === "csv") {
      fileContent = await file.text();
    } else {
      const parserUrl = process.env.PARSER_URL || "http://localhost:8001/parse";
      const formData = new FormData();
      formData.append("file", file);
      try {
        const resp = await fetch(parserUrl, {
          method: "POST",
          body: formData,
          signal: AbortSignal.timeout(30000),
        });
        if (resp.ok) {
          const result = await resp.json();
          fileContent = result.content || null;
        }
      } catch {
        fileContent = await file.text();
      }
    }
  } catch (e: any) {
    console.error(`[doc] Failed to read file ${doc.id}:`, e.message);
  }

  // Asynchron chunken + status aktualisieren
  if (fileContent) {
    scheduleChunking(doc.id, workspaceId, fileContent);
  }

  return c.json({ document: doc }, 201);
});

// URL importieren
documentRouter.post("/import-url", zValidator("json", urlSchema), async (c) => {
  const user = c.get("user");
  const { workspace_id, url, title } = c.req.valid("json");

  const doc = await documentService.createDocument({
    id: crypto.randomUUID(),
    workspace_id,
    title: title || url,
    type: "url",
    source: url,
    source_url: url,
    created_by: user.id,
  });

  // Asynchron URL laden
  fetchAndParseUrl(doc.id, url);

  return c.json({ document: doc }, 201);
});

// Dokument löschen
documentRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  await documentService.deleteDocument(id);
  return c.json({ success: true });
});

// --- Hintergrund-Verarbeitung ---

async function scheduleChunking(docId: string, workspaceId: string, text: string) {
  try {
    await documentService.updateDocumentStatus(docId, "processing");

    if (!text || text.trim().length === 0) {
      await documentService.updateDocumentStatus(docId, "failed", "No text could be extracted");
      return;
    }

    const chunkList = documentService.splitIntoChunks(text);
    if (chunkList.length > 0) {
      await documentService.saveChunks(docId, workspaceId, chunkList);
    }

    await documentService.updateDocumentStatus(docId, "completed");
    console.log(`[doc] Parsed ${docId}: ${chunkList.length} chunks`);
  } catch (e: any) {
    console.error(`[doc] Parse error ${docId}:`, e.message);
    await documentService.updateDocumentStatus(docId, "failed", e.message);
  }
}

async function fetchAndParseUrl(docId: string, url: string) {
  // Für TXT und MD: Direkt als Text lesen
  if (fileType === "txt" || fileType === "md" || fileType === "csv") {
    return await file.text();
  }

  // Für PDF, DOCX, HTML: Parser-Microservice verwenden
  const parserUrl = process.env.PARSER_URL || "http://localhost:8001/parse";
  try {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(parserUrl, {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      throw new Error(`Parser returned ${response.status}`);
    }

    const result = await response.json();
    return result.content || "";
  } catch (e: any) {
    console.error(`[parser] Error parsing ${file.name}:`, e.message);
    // Fallback: Bei Fehler trotzdem Rohtext versuchen
    try {
      return await file.text();
    } catch {
      throw new Error(`Failed to parse ${fileType} file: ${e.message}`);
    }
  }
}

export { documentRouter };
