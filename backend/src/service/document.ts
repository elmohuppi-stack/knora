import { db } from "../db/index.ts";
import {
  documents,
  chunks,
  wikiPages,
  activityLogs,
  documentTopics,
} from "../db/schema.ts";
import { eq, desc, asc, and, sql, ilike, gte, lte, inArray } from "drizzle-orm";

export type DocumentSort =
  | "created_desc"
  | "created_asc"
  | "published_desc"
  | "published_asc"
  | "title_asc"
  | "title_desc";

export interface ListDocumentsOptions {
  type?: string;
  channel?: string;
  query?: string;
  dateFrom?: Date;
  dateTo?: Date;
  topicIds?: string[];
  sort?: DocumentSort;
}

export async function listDocuments(
  workspaceId: string,
  opts: ListDocumentsOptions = {},
) {
  const conditions = [eq(documents.workspace_id, workspaceId)];
  if (opts.type) conditions.push(eq(documents.type, opts.type));
  if (opts.channel) conditions.push(eq(documents.channel, opts.channel));
  if (opts.query) conditions.push(ilike(documents.title, `%${opts.query}%`));
  // Datumsbereich filtert auf das Import-Datum (created_at, immer vorhanden).
  if (opts.dateFrom) conditions.push(gte(documents.created_at, opts.dateFrom));
  if (opts.dateTo) conditions.push(lte(documents.created_at, opts.dateTo));
  // Themen-Filter (Ebene 1): Dokumente mit einem der Themen (Subquery auf Junction).
  if (opts.topicIds && opts.topicIds.length > 0) {
    conditions.push(
      inArray(
        documents.id,
        db
          .select({ id: documentTopics.document_id })
          .from(documentTopics)
          .where(inArray(documentTopics.topic_id, opts.topicIds)),
      ),
    );
  }

  const orderBy = (() => {
    switch (opts.sort) {
      case "created_asc":
        return asc(documents.created_at);
      // published_at kann null sein (nicht-YouTube / Altbestand) → NULLS LAST,
      // damit Videos mit Datum vorne stehen.
      case "published_desc":
        return sql`${documents.published_at} desc nulls last`;
      case "published_asc":
        return sql`${documents.published_at} asc nulls last`;
      case "title_asc":
        return asc(documents.title);
      case "title_desc":
        return desc(documents.title);
      case "created_desc":
      default:
        return desc(documents.created_at);
    }
  })();

  return await db
    .select()
    .from(documents)
    .where(and(...conditions))
    .orderBy(orderBy);
}

/** Distinct-Kanäle eines Workspace (für das Kanal-Filter-Dropdown). */
export async function listChannels(workspaceId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ channel: documents.channel })
    .from(documents)
    .where(
      and(
        eq(documents.workspace_id, workspaceId),
        sql`${documents.channel} is not null and ${documents.channel} <> ''`,
      ),
    );
  return rows
    .map((r) => r.channel as string)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "de"));
}

export async function getDocument(id: string) {
  const [doc] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, id))
    .limit(1);
  return doc || null;
}

export async function createDocument(data: {
  id: string;
  workspace_id: string;
  title: string;
  type: string;
  source: string;
  source_url?: string;
  content?: string;
  file_path?: string;
  file_size?: number;
  file_hash?: string;
  channel?: string | null;
  published_at?: Date | null;
  duration?: number | null;
  source_metadata?: Record<string, unknown>;
  created_by: number;
}) {
  const [doc] = await db.insert(documents).values(data).returning();
  return doc;
}

/** Aktualisiert die Herkunfts-Metadaten (Ebene 2, z.B. YouTube-Refresh). */
export async function updateDocumentMetadata(
  id: string,
  data: {
    channel?: string | null;
    published_at?: Date | null;
    duration?: number | null;
    source_metadata?: Record<string, unknown>;
  },
) {
  const [doc] = await db
    .update(documents)
    .set({ ...data, updated_at: new Date() })
    .where(eq(documents.id, id))
    .returning();
  return doc || null;
}

export async function updateDocumentStatus(
  id: string,
  status: string,
  error?: string,
  chunkCount?: number,
) {
  const updateData: Record<string, any> = {
    parse_status: status,
    updated_at: new Date(),
  };
  if (status === "processing") {
    updateData.processed_at = null;
  }
  if (status === "completed") {
    updateData.processed_at = new Date();
  }
  if (chunkCount !== undefined) {
    updateData.chunk_count = chunkCount;
  }
  if (error) {
    updateData.parse_error = error;
  }
  const [doc] = await db
    .update(documents)
    .set(updateData)
    .where(eq(documents.id, id))
    .returning();
  return doc || null;
}

export async function updateDocumentContent(id: string, content: string) {
  const [doc] = await db
    .update(documents)
    .set({ content, updated_at: new Date() })
    .where(eq(documents.id, id))
    .returning();
  return doc || null;
}

export async function deleteDocument(id: string) {
  // Wiki-Seiten, die auf dieses Dokument verweisen, bereinigen
  await db
    .update(wikiPages)
    .set({ source_document_id: null })
    .where(eq(wikiPages.source_document_id, id));
  // Activity-Logs entkoppeln (FK ohne Cascade → sonst Constraint-Fehler beim Löschen).
  // Log-Historie bleibt erhalten, nur die Dokument-Referenz wird entfernt.
  await db
    .update(activityLogs)
    .set({ document_id: null })
    .where(eq(activityLogs.document_id, id));
  // Themen-Zuordnungen entfernen (FK ohne Cascade).
  await db.delete(documentTopics).where(eq(documentTopics.document_id, id));
  await db.delete(chunks).where(eq(chunks.document_id, id));
  await db.delete(documents).where(eq(documents.id, id));
}

export async function saveChunks(
  documentId: string,
  workspaceId: string,
  chunkData: { content: string; chunk_index: number; token_count: number }[],
) {
  if (chunkData.length === 0) return [];

  // Bulk-Insert: ein einziger Round-Trip statt N Einzel-Inserts. Verhindert,
  // dass ein langes Transkript den DB-Pool über viele serielle Queries blockiert.
  const values = chunkData.map((c) => ({
    id: crypto.randomUUID(),
    document_id: documentId,
    workspace_id: workspaceId,
    content: c.content,
    chunk_index: c.chunk_index,
    token_count: c.token_count,
  }));

  return await db.insert(chunks).values(values).returning();
}

// Hilfsfunktion: Text in Chunks teilen
export function splitIntoChunks(
  text: string,
  chunkSize: number = 512,
  overlap: number = 50,
) {
  if (!text || text.length === 0) return [];

  const chunks: {
    content: string;
    chunk_index: number;
    token_count: number;
  }[] = [];
  let start = 0;
  let index = 0;

  // Sicherstellen, dass der Fortschritt pro Iteration positiv ist. Sonst
  // (z.B. overlap >= chunkSize, oder am Textende wenn end nicht mehr wächst)
  // würde start nicht vorankommen → Endlosschleife.
  const step = Math.max(1, chunkSize - overlap);

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    const content = text.slice(start, end);

    chunks.push({
      content,
      chunk_index: index,
      token_count: content.split(/\s+/).length,
    });

    index++;

    // Letzter Chunk erreicht das Textende → fertig.
    if (end >= text.length) break;

    start += step;
  }

  return chunks;
}
