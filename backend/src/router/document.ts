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
  });

  // Datei-Bytes im Request-Kontext lesen (File ist nur hier gültig),
  // die eigentliche Verarbeitung läuft entkoppelt vom HTTP-Response.
  const buffer = await file.arrayBuffer();
  setTimeout(() => {
    processUploadedFile(
      doc.id,
      workspaceId,
      user.id,
      fileName,
      fileType,
      buffer,
    ).catch((e: any) =>
      console.error(`[doc] Upload-Verarbeitung fehlgeschlagen:`, e.message),
    );
  }, 100);

  return c.json({ document: doc }, 201);
});

/**
 * Extrahiert Text aus einer hochgeladenen Datei, speichert ihn und startet
 * Chunking + Wiki-Generierung. Läuft entkoppelt vom HTTP-Response.
 */
async function processUploadedFile(
  docId: string,
  workspaceId: string,
  userId: number,
  fileName: string,
  fileType: string,
  buffer: ArrayBuffer,
) {
  const t0 = Date.now();
  const logId = await logActivity({
    action: "file_import",
    status: "started",
    message: `Verarbeite Datei: ${fileName}`,
    details: { fileName, fileType },
    workspace_id: workspaceId,
    document_id: docId,
    user_id: userId,
  });

  try {
    await documentService.updateDocumentStatus(docId, "processing");

    let text = "";
    const isPlainText =
      fileType === "txt" || fileType === "md" || fileType === "csv";

    if (isPlainText) {
      text = new TextDecoder().decode(buffer);
    } else {
      // PDF, DOCX, HTML: Parser-Microservice (MarkItDown) verwenden
      const parserUrl = process.env.PARSER_URL || "http://localhost:8001/parse";
      const formData = new FormData();
      formData.append(
        "file",
        new Blob([buffer]),
        fileName,
      );
      const resp = await fetch(parserUrl, {
        method: "POST",
        body: formData,
        signal: AbortSignal.timeout(60000),
      });
      if (!resp.ok) {
        throw new Error(
          `Parser nicht erreichbar (HTTP ${resp.status}) – .${fileType} kann nicht ohne Parser-Service gelesen werden`,
        );
      }
      const result = await resp.json();
      // HTML-Fallback: falls Parser nichts liefert, eigene Extraktion
      text = result.content || "";
      if ((!text || text.trim().length === 0) && fileType === "html") {
        text = htmlToText(new TextDecoder().decode(buffer));
      }
    }

    if (!text || text.trim().length === 0) {
      throw new Error("Kein Textinhalt aus der Datei extrahierbar");
    }

    // Content speichern (Wiki-Generierung liest doc.content) + chunken
    await documentService.updateDocumentContent(docId, text);
    await scheduleChunking(docId, workspaceId, text);

    await updateLog(logId, {
      status: "completed",
      message: `„${fileName}” verarbeitet (${text.length} Zeichen)`,
      details: { fileName, chars: text.length, doc_id: docId },
      duration_ms: Date.now() - t0,
    });

    // Wiki-Artikel asynchron generieren
    setTimeout(() => scheduleWikiGeneration(docId, workspaceId, userId), 1000);
  } catch (e: any) {
    console.error(`[doc] Datei-Verarbeitung fehlgeschlagen ${docId}:`, e.message);
    try {
      await documentService.updateDocumentStatus(docId, "failed", e.message);
    } catch {}
    await updateLog(logId, {
      status: "failed",
      message: `Fehler: ${e.message}`,
      duration_ms: Date.now() - t0,
    });
  }
}

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

  // Asynchron URL laden (entkoppelt vom Request-Kontext)
  setTimeout(() => {
    fetchAndParseUrl(doc.id, url, workspace_id, user.id).catch((e: any) =>
      console.error(`[doc] URL-Import fehlgeschlagen:`, e.message),
    );
  }, 100);

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

    // Chunking starten (async – entkoppelt vom Request-Kontext)
    console.log(`[doc] Starte Chunking für ${doc.id}...`);
    setTimeout(() => {
      scheduleChunking(doc.id, workspace_id, content).catch((e: any) =>
        console.error(`[doc] Chunking fehlgeschlagen:`, e.message),
      );
    }, 100);

    // Wiki-Artikel asynchron generieren
    setTimeout(
      () => scheduleWikiGeneration(doc.id, workspace_id, user.id),
      1000,
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

    await documentService.updateDocumentStatus(
      docId,
      "completed",
      undefined,
      chunkList.length,
    );
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
    try {
      await documentService.updateDocumentStatus(docId, "failed", e.message);
    } catch {}
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
    const { generateWikiArticles } =
      await import("../service/wiki-generate.ts");

    const result = await generateWikiArticles(docId, workspaceId);

    if (result) {
      await updateLog(logId, {
        status: "completed",
        message: `Wiki-Seiten erstellt/aktualisiert: Summary + ${result.entities} Entities + ${result.concepts} Concepts`,
        details: {
          document_id: docId,
          summary_id: result.summary?.id,
          entities: result.entities,
          concepts: result.concepts,
        },
        duration_ms: Date.now() - t0,
      });
      console.log(
        `[doc] ✅ Wiki-Generierung abgeschlossen: ${result.entities} Entities, ${result.concepts} Concepts`,
      );
    } else {
      await updateLog(logId, {
        status: "failed",
        message: "Wiki-Generierung ergab kein Ergebnis (kein LLM-Provider?)",
        duration_ms: Date.now() - t0,
      });
      console.log(`[doc] ⚠️ Wiki-Generierung ergab kein Ergebnis`);
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

/**
 * Lädt eine Webseite, extrahiert den Textinhalt, speichert ihn und startet
 * Chunking + Wiki-Generierung. Läuft entkoppelt vom HTTP-Response (fire-and-forget).
 */
async function fetchAndParseUrl(
  docId: string,
  url: string,
  workspaceId: string,
  userId: number,
) {
  const t0 = Date.now();
  const logId = await logActivity({
    action: "url_import",
    status: "started",
    message: `Importiere URL: ${url}`,
    details: { url },
    workspace_id: workspaceId,
    document_id: docId,
    user_id: userId,
  });

  try {
    await documentService.updateDocumentStatus(docId, "processing");

    // Webseite mit Browser-ähnlichen Headern laden (reduziert 403-Rejections)
    const resp = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} beim Laden der URL`);
    }
    const html = await resp.text();

    // Bevorzugt: Parser-Microservice (MarkItDown → sauberes Markdown)
    let text = "";
    const parserUrl = process.env.PARSER_URL || "http://localhost:8001/parse";
    try {
      const formData = new FormData();
      formData.append(
        "file",
        new Blob([html], { type: "text/html" }),
        "page.html",
      );
      const parserResp = await fetch(parserUrl, {
        method: "POST",
        body: formData,
        signal: AbortSignal.timeout(30000),
      });
      if (parserResp.ok) {
        const result = await parserResp.json();
        text = result.content || "";
      }
    } catch (e: any) {
      console.warn(`[doc] Parser für URL nicht erreichbar:`, e.message);
    }

    // Fallback: eigene HTML→Text-Extraktion (kein Parser nötig)
    if (!text || text.trim().length === 0) {
      text = htmlToText(html);
    }

    if (!text || text.trim().length === 0) {
      throw new Error("Kein Textinhalt aus der URL extrahierbar");
    }

    // Content speichern (Wiki-Generierung liest doc.content) + chunken
    await documentService.updateDocumentContent(docId, text);
    await scheduleChunking(docId, workspaceId, text);

    await updateLog(logId, {
      status: "completed",
      message: `URL importiert (${text.length} Zeichen)`,
      details: { url, chars: text.length, doc_id: docId },
      duration_ms: Date.now() - t0,
    });

    // Wiki-Artikel asynchron generieren
    setTimeout(() => scheduleWikiGeneration(docId, workspaceId, userId), 1000);
  } catch (e: any) {
    console.error(`[doc] URL-Import fehlgeschlagen ${docId}:`, e.message);
    try {
      await documentService.updateDocumentStatus(docId, "failed", e.message);
    } catch {}
    await updateLog(logId, {
      status: "failed",
      message: `Fehler: ${e.message}`,
      duration_ms: Date.now() - t0,
    });
  }
}

/** Extrahiert sauberen Text aus HTML: entfernt Skripte/Styles/Navigation. */
function htmlToText(html: string): string {
  const text = html
    // Nicht-inhaltliche Blöcke komplett entfernen
    .replace(
      /<(script|style|nav|footer|header|iframe|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi,
      " ",
    )
    // Kommentare entfernen
    .replace(/<!--[\s\S]*?-->/g, " ")
    // Blockelemente in Zeilenumbrüche wandeln
    .replace(/<\/(p|div|li|h[1-6]|tr|br)\s*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    // Restliche Tags strippen
    .replace(/<[^>]+>/g, " ")
    // Numerische HTML-Entities dekodieren (&#8211; usw.)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    // Benannte HTML-Entities (häufigste)
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // Whitespace normalisieren: Leerzeilen zusammenfassen
  return text
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter((l) => l !== "")
    .join("\n");
}

export { documentRouter };
