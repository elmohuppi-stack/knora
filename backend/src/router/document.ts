import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { authMiddleware } from "../middleware/auth.ts";
import * as documentService from "../service/document.ts";
import {
  extractVideoId,
  fetchYouTubeInfo,
  buildDocumentContent,
} from "../service/youtube.ts";
import { logActivity, updateLog } from "../service/activity-log.ts";

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

// YouTube-Video importieren
const youTubeSchema = z.object({
  workspace_id: z.string().uuid(),
  url: z.string(),
});

documentRouter.post(
  "/import-youtube",
  zValidator("json", youTubeSchema),
  async (c) => {
    const user = c.get("user");
    const { workspace_id, url } = c.req.valid("json");

    const t0 = Date.now();
    console.log(`[doc] ========== YouTube-Import gestartet ==========`);
    console.log(`[doc] URL: ${url}`);
    console.log(`[doc] Workspace: ${workspace_id}`);
    console.log(`[doc] User: ${user.id} (${user.email})`);

    const videoId = extractVideoId(url);
    if (!videoId) {
      console.log(`[doc] ❌ Ungültige YouTube-URL: ${url}`);
      return c.json({ error: "Invalid YouTube URL" }, 400);
    }
    console.log(`[doc] Video-ID: ${videoId}`);

    const logId = await logActivity({
      action: "youtube_import",
      status: "started",
      message: `Importiere YouTube-Video: ${url}`,
      details: { url, videoId },
      workspace_id,
      user_id: user.id,
    });

    console.log(`[doc] Rufe YouTube-Info ab (fetchYouTubeInfo)...`);
    const info = await fetchYouTubeInfo(videoId);

    if (!info) {
      console.log(`[doc] ❌ Konnte keine Video-Informationen abrufen`);
      await updateLog(logId, {
        status: "failed",
        message: "Keine Video-Informationen abrufbar",
        duration_ms: Date.now() - t0,
      });
      return c.json({ error: "Could not fetch video information" }, 400);
    }

    console.log(`[doc] ✅ Video-Titel: "${info.title}"`);
    console.log(`[doc] ✅ Kanal: ${info.channelName}`);
    console.log(`[doc] ✅ Dauer: ${info.duration}s`);
    console.log(
      `[doc] ✅ Transkript: ${info.transcript.length} Zeichen (${info.transcriptLanguage})`,
    );

    const content = buildDocumentContent(info);
    console.log(`[doc] Dokument-Content: ${content.length} Zeichen`);

    const doc = await documentService.createDocument({
      id: crypto.randomUUID(),
      workspace_id,
      title: info.title,
      type: "youtube",
      source: url,
      source_url: `https://www.youtube.com/watch?v=${videoId}`,
      content,
      created_by: user.id,
    });
    console.log(`[doc] ✅ Dokument erstellt: ${doc.id}`);

    await updateLog(logId, {
      status: "completed",
      message: `„${info.title}” importiert (${info.transcript.length} Zeichen)`,
      details: {
        title: info.title,
        channel: info.channelName,
        transcript_len: info.transcript.length,
        doc_id: doc.id,
      },
      duration_ms: Date.now() - t0,
    });

    // Chunking starten (async)
    console.log(`[doc] Starte Chunking für ${doc.id}...`);
    scheduleChunking(doc.id, workspace_id, content);

    // Wiki-Artikel asynchron generieren
    setTimeout(
      () => scheduleWikiGeneration(doc.id, workspace_id, user.id),
      500,
    );

    console.log(
      `[doc] ========== YouTube-Import abgeschlossen (${Date.now() - t0}ms) ==========`,
    );
    return c.json({ document: doc }, 201);
  },
);

// Dokument löschen
documentRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  await documentService.deleteDocument(id);
  return c.json({ success: true });
});

// --- Hintergrund-Verarbeitung ---

async function scheduleChunking(
  docId: string,
  workspaceId: string,
  text: string,
) {
  try {
    await documentService.updateDocumentStatus(docId, "processing");

    if (!text || text.trim().length === 0) {
      await documentService.updateDocumentStatus(
        docId,
        "failed",
        "No text could be extracted",
      );
      return;
    }

    const chunkList = documentService.splitIntoChunks(text);
    if (chunkList.length > 0) {
      await documentService.saveChunks(docId, workspaceId, chunkList);
    }

    await documentService.updateDocumentStatus(docId, "completed");
    console.log(`[doc] Parsed ${docId}: ${chunkList.length} chunks`);

    // Embedding im Hintergrund starten (nicht-blockierend)
    try {
      const { embedWorkspaceChunks } = await import("../service/embedding.ts");
      embedWorkspaceChunks(workspaceId).then((r) =>
        console.log(`[doc] Embedded ${r.processed} chunks for doc ${docId}`),
      );
    } catch (e: any) {
      console.warn(`[doc] Embedding trigger failed:`, e.message);
    }
  } catch (e: any) {
    console.error(`[doc] Parse error ${docId}:`, e.message);
    await documentService.updateDocumentStatus(docId, "failed", e.message);
  }
}

/** Wiki-Artikel asynchron generieren (Blockiert nicht den HTTP-Response) */
async function scheduleWikiGeneration(
  docId: string,
  workspaceId: string,
  userId: number,
) {
  const t0 = Date.now();
  const logId = await logActivity({
    action: "wiki_generate",
    status: "started",
    message: `Generiere Wiki-Artikel aus Dokument ${docId.slice(0, 8)}...`,
    details: { document_id: docId },
    workspace_id: workspaceId,
    document_id: docId,
    user_id: userId,
  });

  console.log(`[doc] ========== scheduleWikiGeneration START ==========`);
  console.log(`[doc] Erstelle Wiki-Artikel für Dokument ${docId}...`);

  try {
    const {
      listPages,
      generateWikiPage,
      createPage,
      resolveLinks,
      updateIncomingLinks,
      updatePage,
    } = await import("../service/wiki.ts");

    console.log(`[doc] Lade existierende Wiki-Seiten...`);
    const existing = await listPages(workspaceId, { page_size: 200 });
    const existingSlugs = existing.pages.map((p: any) => p.slug);
    console.log(
      `[doc] ${existing.pages.length} existierende Wiki-Seiten gefunden`,
    );

    console.log(`[doc] Rufe LLM zur Wiki-Generierung auf...`);
    const wikiResults = await generateWikiPage(
      workspaceId,
      docId,
      existingSlugs,
    );

    if (wikiResults && wikiResults.length > 0) {
      const createdPages: string[] = [];
      const allSlugs = [...existingSlugs];

      for (const article of wikiResults) {
        let slug = article.slug;
        let counter = 1;
        while (allSlugs.includes(slug)) {
          slug = `${article.slug}-${counter}`;
          counter++;
        }
        allSlugs.push(slug);

        console.log(
          `[doc] Wiki-Seite wird erstellt: slug="${slug}", title="${article.title}"`,
        );
        const page = await createPage({
          workspace_id: workspaceId,
          slug,
          title: article.title,
          content: article.content,
          summary: article.summary,
          page_type: article.page_type,
          source_document_id: docId,
          created_by: userId,
        });
        createdPages.push(page.title);

        const { out_links } = await resolveLinks(workspaceId, article.content);
        if (out_links.length > 0) {
          try {
            await updatePage(workspaceId, slug, { out_links });
            await updateIncomingLinks(workspaceId, slug, out_links);
            console.log(
              `[doc] ${out_links.length} Wiki-Links für "${slug}" aufgelöst`,
            );
          } catch (linkErr: any) {
            console.warn(
              `[doc] Link-Resolution fehlgeschlagen:`,
              linkErr.message,
            );
          }
        }
      }

      await updateLog(logId, {
        status: "completed",
        message: `${createdPages.length} Wiki-Seiten erstellt: ${createdPages.join(", ")}`,
        details: {
          title: wikiResult.title,
          slug,
          content_len: wikiResult.content.length,
        },
        duration_ms: Date.now() - t0,
      });
      console.log(`[doc] ✅ ${createdPages.length} Wiki-Seiten erstellt`);
    } else {
      await updateLog(logId, {
        status: "failed",
        message: "Wiki-Generierung ergab kein Ergebnis (kein LLM-Provider?)",
        duration_ms: Date.now() - t0,
      });
      console.log(
        `[doc] ⚠️ Wiki-Generierung ergab kein Ergebnis (kein LLM-Provider?)`,
      );
    }
  } catch (e: any) {
    await updateLog(logId, {
      status: "failed",
      message: `Fehler: ${e.message}`,
      duration_ms: Date.now() - t0,
    });
    console.warn(`[doc] ❌ Wiki-Generierung fehlgeschlagen:`, e.message);
  }

  console.log(`[doc] ========== scheduleWikiGeneration ENDE ==========`);
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
