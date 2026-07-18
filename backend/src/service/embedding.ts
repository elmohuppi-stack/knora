import { db } from "../db/index.ts";
import { chunks, modelProviders, documents } from "../db/schema.ts";
import { eq, isNull, and, sql } from "drizzle-orm";

// OpenAI-kompatible Embedding-API aufrufen
async function generateEmbedding(text: string): Promise<number[] | null> {
  // Aktiven Embedding-Provider aus DB laden
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

  if (providers.length === 0) {
    // Fallback: Chat-Provider mit Embedding-Fähigkeit
    const chatProviders = await db
      .select()
      .from(modelProviders)
      .where(
        and(
          eq(modelProviders.is_active, true),
          eq(modelProviders.provider_type, "both"),
        ),
      )
      .limit(1);

    if (chatProviders.length === 0) {
      console.warn("[embed] No active embedding provider configured");
      return null;
    }
    return await callEmbeddingAPI(chatProviders[0], text);
  }

  return await callEmbeddingAPI(providers[0], text);
}

async function callEmbeddingAPI(
  provider: typeof modelProviders.$inferSelect,
  text: string,
): Promise<number[] | null> {
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
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      console.warn(
        `[embed] API error: ${response.status} ${await response.text()}`,
      );
      return null;
    }

    const data = await response.json();
    const vector = data?.data?.[0]?.embedding;
    if (!vector || !Array.isArray(vector)) {
      console.warn("[embed] Unexpected API response format");
      return null;
    }
    return vector;
  } catch (e: any) {
    console.warn(`[embed] API call failed:`, e.message);
    return null;
  }
}

// Embedding für einen einzelnen Chunk generieren und speichern
export async function embedChunk(chunkId: string, content: string) {
  const vector = await generateEmbedding(content);
  if (!vector) return false;

  try {
    // pgvector erwartet einen String im PostgreSQL-Format "[1,2,3]".
    // sql-Template statt db.execute mit Positions-Parametern, das der
    // node-postgres-Treiber hier nicht korrekt bindet ("no parameter $2").
    const vectorLiteral = `[${vector.join(",")}]`;
    await db
      .update(chunks)
      .set({ embedding: sql`${vectorLiteral}::vector` })
      .where(eq(chunks.id, chunkId));
    return true;
  } catch (e: any) {
    console.error(
      `[embed] Failed to save embedding for chunk ${chunkId}:`,
      e.message,
    );
    return false;
  }
}

// Alle unembedded Chunks eines Workspace verarbeiten.
// In Batches bis alles embedded ist (nicht nur die ersten 50) – sonst bleiben
// z.B. die bei der Wiki-Generierung erzeugten Chunks dauerhaft ohne Embedding
// und tauchen nie in der Vektorsuche auf.
export async function embedWorkspaceChunks(workspaceId: string) {
  let processed = 0;
  let total = 0;

  for (let batch = 0; batch < 100; batch++) {
    const unembedded = await db
      .select({ id: chunks.id, content: chunks.content })
      .from(chunks)
      .where(
        and(eq(chunks.workspace_id, workspaceId), isNull(chunks.embedding)),
      )
      .limit(50);

    if (unembedded.length === 0) break;

    for (const chunk of unembedded) {
      total++;
      const ok = await embedChunk(chunk.id, chunk.content);
      if (ok) processed++;
      // Kleine Verzögerung um Rate-Limits zu vermeiden
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  if (total > 0) {
    console.log(
      `[embed] Embedded ${processed}/${total} chunks in workspace ${workspaceId}`,
    );
  }
  return { processed, total };
}

// Chunk-Content kürzen auf max Token
function truncateText(text: string, maxChars: number = 8000): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}
