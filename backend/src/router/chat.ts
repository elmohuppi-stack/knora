import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { authMiddleware } from "../middleware/auth.ts";
import { hybridSearch } from "../service/search.ts";
import { db } from "../db/index.ts";
import { chatSessions, chatMessages, modelProviders } from "../db/schema.ts";
import { eq, desc, and } from "drizzle-orm";

const chatRouter = new Hono();
chatRouter.use("*", authMiddleware);

const chatSchema = z.object({
  workspace_id: z.string().uuid().optional(),
  message: z.string().min(1),
  session_id: z.string().uuid().optional(),
});

// Chat-Nachricht senden (mit RAG)
chatRouter.post("/", zValidator("json", chatSchema), async (c) => {
  const user = c.get("user");
  const { workspace_id, message, session_id } = c.req.valid("json");

  // Session ermitteln oder erstellen
  let session = session_id ? null : null;
  if (session_id) {
    const sessions = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.id, session_id))
      .limit(1);
    session = sessions[0] || null;
  }

  if (!session) {
    const [newSession] = await db
      .insert(chatSessions)
      .values({
        id: crypto.randomUUID(),
        workspace_id: workspace_id || null,
        user_id: user.id,
        title: message.slice(0, 80),
      })
      .returning();
    session = newSession;
  }

  // User-Nachricht speichern
  await db.insert(chatMessages).values({
    id: crypto.randomUUID(),
    session_id: session.id,
    role: "user",
    content: message,
  });

  // RAG: Suche nach relevanten Chunks
  let searchResults: any[] = [];
  if (workspace_id) {
    searchResults = await hybridSearch(workspace_id, message, 5);
  }

  // Prompt mit Kontext bauen
  const context = searchResults
    .map((r) => `[${r.document_title}]: ${r.content}`)
    .join("\n\n");

  const activeProvider = await db
    .select()
    .from(modelProviders)
    .where(
      and(
        eq(modelProviders.is_active, true),
        eq(modelProviders.provider_type, "chat"),
      ),
    )
    .limit(1);

  let provider = activeProvider[0];
  if (!provider) {
    const bothProviders = await db
      .select()
      .from(modelProviders)
      .where(
        and(
          eq(modelProviders.is_active, true),
          eq(modelProviders.provider_type, "both"),
        ),
      )
      .limit(1);
    provider = bothProviders[0];
  }

  let reply = "";
  if (provider) {
    reply = await callLLM(provider, message, context);
  } else {
    reply =
      "Kein Chat-Provider konfiguriert. Bitte im Admin einen Provider anlegen.";
  }

  // Assistant-Antwort speichern
  const [assistantMsg] = await db
    .insert(chatMessages)
    .values({
      id: crypto.randomUUID(),
      session_id: session.id,
      role: "assistant",
      content: reply,
      knowledge_refs: searchResults.map((r) => ({
        chunk_id: r.chunk_id,
        document_title: r.document_title,
        score: r.score,
      })),
    })
    .returning();

  return c.json({
    session_id: session.id,
    message: {
      id: assistantMsg.id,
      role: "assistant",
      content: reply,
      knowledge_refs: assistantMsg.knowledge_refs,
    },
    sources: searchResults.map((r) => ({
      title: r.document_title,
      score: r.score,
    })),
  });
});

// Sessions auflisten
chatRouter.get("/sessions", async (c) => {
  const user = c.get("user");
  const sessions = await db
    .select()
    .from(chatSessions)
    .where(eq(chatSessions.user_id, user.id))
    .orderBy(desc(chatSessions.updated_at))
    .limit(50);
  return c.json({ sessions });
});

// Messages einer Session
chatRouter.get("/sessions/:id/messages", async (c) => {
  const id = c.req.param("id");
  const msgs = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.session_id, id))
    .orderBy(chatMessages.created_at);
  return c.json({ messages: msgs });
});

async function callLLM(
  provider: typeof modelProviders.$inferSelect,
  message: string,
  context: string,
): Promise<string> {
  const systemPrompt = context
    ? `Du bist ein hilfreicher Assistent mit Zugriff auf eine Wissensdatenbank. 
Antworte auf Deutsch basierend auf dem folgenden Kontext. 
Wenn die Antwort nicht im Kontext enthalten ist, sag dass du es nicht weißt.

KONTEXT:
${context}`
    : "Du bist ein hilfreicher Assistent. Antworte auf Deutsch.";

  try {
    const response = await fetch(`${provider.api_base_url}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.api_key_encrypted}`,
      },
      body: JSON.stringify({
        model: provider.default_model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message },
        ],
        max_tokens: 1024,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const errText = await response.text();
      return `❌ API-Fehler (${response.status}): ${errText.slice(0, 200)}`;
    }

    const data = await response.json();
    return data?.choices?.[0]?.message?.content || "❌ Leere Antwort vom LLM";
  } catch (e: any) {
    return `❌ Fehler bei der LLM-Anfrage: ${e.message}`;
  }
}

export { chatRouter };
