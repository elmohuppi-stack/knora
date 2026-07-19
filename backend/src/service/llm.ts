// Gemeinsame LLM-Helfer (OpenAI-kompatibel, reiner fetch).
// Genutzt von wiki-generate.ts (Artikel-Generierung) und topic.ts
// (Themen-Vorschläge/Klassifikation). Als eigenes Modul, um Zirkelbezüge
// zwischen Generator und Topic-Service zu vermeiden.
import { db } from "../db/index.ts";
import { modelProviders } from "../db/schema.ts";
import { and, eq } from "drizzle-orm";

/** Aktiven Chat-Provider ermitteln (chat, sonst both). */
export async function getActiveProvider() {
  let providers = await db
    .select()
    .from(modelProviders)
    .where(
      and(
        eq(modelProviders.is_active, true),
        eq(modelProviders.provider_type, "chat"),
      ),
    )
    .limit(1);

  if (!providers[0]) {
    providers = await db
      .select()
      .from(modelProviders)
      .where(
        and(
          eq(modelProviders.is_active, true),
          eq(modelProviders.provider_type, "both"),
        ),
      )
      .limit(1);
  }
  return providers[0] || null;
}

export async function callLLM(
  provider: any,
  prompt: string,
): Promise<string | null> {
  try {
    const response = await fetch(`${provider.api_base_url}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.api_key_encrypted}`,
      },
      body: JSON.stringify({
        model: provider.default_model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 8192,
      }),
      signal: AbortSignal.timeout(120000),
    });

    if (!response.ok) {
      const err = await response.text().catch(() => "");
      console.warn(`[llm] error ${response.status}: ${err.slice(0, 200)}`);
      return null;
    }

    const data = await response.json();
    return data?.choices?.[0]?.message?.content || null;
  } catch (e: any) {
    console.warn(`[llm] call failed: ${e.message}`);
    return null;
  }
}

export async function callLLMJson<T>(
  provider: any,
  prompt: string,
): Promise<T | null> {
  const raw = await callLLM(provider, prompt);
  if (!raw) return null;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]) as T;
    return JSON.parse(raw) as T;
  } catch (e: any) {
    console.warn(`[llm] JSON parse failed: ${e.message}`);
    return null;
  }
}
