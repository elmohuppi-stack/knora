import { db } from "../db/index.ts";
import { documents, chunks } from "../db/schema.ts";
import { eq, desc, and } from "drizzle-orm";

export async function listDocuments(workspaceId: string) {
  return await db
    .select()
    .from(documents)
    .where(eq(documents.workspace_id, workspaceId))
    .orderBy(desc(documents.created_at));
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
  created_by: number;
}) {
  const [doc] = await db.insert(documents).values(data).returning();
  return doc;
}

export async function updateDocumentStatus(
  id: string,
  status: string,
  error?: string,
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

export async function deleteDocument(id: string) {
  await db.delete(chunks).where(eq(chunks.document_id, id));
  await db.delete(documents).where(eq(documents.id, id));
}

export async function saveChunks(
  documentId: string,
  workspaceId: string,
  chunkData: { content: string; chunk_index: number; token_count: number }[],
) {
  if (chunkData.length === 0) return [];

  const values = chunkData.map((c) => ({
    id: crypto.randomUUID(),
    document_id: documentId,
    workspace_id: workspaceId,
    content: c.content,
    chunk_index: c.chunk_index,
    token_count: c.token_count,
  }));

  const inserted = await db.insert(chunks).values(values).returning();
  return inserted;
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

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    const content = text.slice(start, end);

    chunks.push({
      content,
      chunk_index: index,
      token_count: content.split(/\s+/).length,
    });

    index++;
    start = end - overlap;
    if (start >= text.length) break;
  }

  return chunks;
}
console.log('[doc] Parsing test...');
