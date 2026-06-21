import { db } from "../db/index.ts";
import { chunks, documents, modelProviders } from "../db/schema.ts";
import { eq, and } from "drizzle-orm";

export interface SearchResult {
  chunk_id: string;
  document_id: string;
  document_title: string;
  content: string;
  score: number;
  search_type: "vector" | "keyword" | "hybrid";
}

// Hybrid Search: Vektor + Keyword kombinieren
export async function hybridSearch(
  workspaceId: string,
  query: string,
  topK: number = 10,
): Promise<SearchResult[]> {
  const vectorResults = await vectorSearch(workspaceId, query, topK);
  const keywordResults = await keywordSearch(workspaceId, query, topK);

  // Ergebnisse mischen (hybrid score = max beider Scores)
  const merged = new Map<string, SearchResult>();

  for (const r of vectorResults) {
    merged.set(r.chunk_id, r);
  }
  for (const r of keywordResults) {
    const existing = merged.get(r.chunk_id);
    if (existing) {
      existing.score = Math.max(existing.score, r.score);
      existing.search_type = "hybrid";
    } else {
      merged.set(r.chunk_id, r);
    }
  }

  return Array.from(merged.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

// Vektor-Suche (pgvector cosine similarity)
async function vectorSearch(
  workspaceId: string,
  query: string,
  topK: number,
): Promise<SearchResult[]> {
  try {
    // Zuerst Embedding für Query generieren
    const vector = await generateQueryEmbedding(query);
    if (!vector) return [];

    // pgvector cosine similarity Abfrage
    const vectorStr = `[${vector.join(",")}]`;
    const rows = await db.execute<{
      chunk_id: string;
      document_id: string;
      document_title: string;
      content: string;
      score: number;
    }>(
      `SELECT 
        c.id as chunk_id,
        c.document_id,
        COALESCE(d.title, 'Unknown') as document_title,
        c.content,
        1 - (c.embedding <=> $1::vector) as score
      FROM chunks c
      LEFT JOIN documents d ON c.document_id = d.id
      WHERE c.workspace_id = $2
        AND c.embedding IS NOT NULL
      ORDER BY c.embedding <=> $1::vector
      LIMIT $3`,
      [vectorStr, workspaceId, topK],
    );

    return rows.map((r: any) => ({
      chunk_id: r.chunk_id,
      document_id: r.document_id,
      document_title: r.document_title,
      content: r.content,
      score: r.score || 0,
      search_type: "vector" as const,
    }));
  } catch (e: any) {
    console.warn("[search] Vector search error:", e.message);
    return [];
  }
}

// Keyword-Suche (PostgreSQL tsvector)
async function keywordSearch(
  workspaceId: string,
  query: string,
  topK: number,
): Promise<SearchResult[]> {
  try {
    const searchTerms = query
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1)
      .join(" & ");

    if (!searchTerms) return [];

    const rows = await db.execute<{
      chunk_id: string;
      document_id: string;
      document_title: string;
      content: string;
      score: number;
    }>(
      `SELECT 
        c.id as chunk_id,
        c.document_id,
        COALESCE(d.title, 'Unknown') as document_title,
        c.content,
        ts_rank(to_tsvector('german', c.content), to_tsquery('german', $1)) as score
      FROM chunks c
      LEFT JOIN documents d ON c.document_id = d.id
      WHERE c.workspace_id = $2
        AND to_tsvector('german', c.content) @@ to_tsquery('german', $1)
      ORDER BY score DESC
      LIMIT $3`,
      [searchTerms, workspaceId, topK],
    );

    return rows.map((r: any) => ({
      chunk_id: r.chunk_id,
      document_id: r.document_id,
      document_title: r.document_title,
      content: r.content,
      score: r.score || 0,
      search_type: "keyword" as const,
    }));
  } catch (e: any) {
    console.warn("[search] Keyword search error:", e.message);
    return [];
  }
}

// Embedding für Query generieren (gleicher Provider wie für Chunks)
async function generateQueryEmbedding(text: string): Promise<number[] | null> {
  const providers = await db
    .select()
    .from(modelProviders)
    .where(
      and(
        eq(modelProviders.is_active, true),
        eq(modelProviders.provider_type, "embedding"),
      ),
    )
    .limit(1);

  const provider = providers[0];
  if (!provider) return null;

  try {
    const response = await fetch(`${provider.api_base_url}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.api_key_encrypted}`,
      },
      body: JSON.stringify({
        model: provider.default_model,
        input: text,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return null;

    const data = await response.json();
    return data?.data?.[0]?.embedding || null;
  } catch {
    return null;
  }
}
