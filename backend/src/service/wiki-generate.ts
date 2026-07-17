/**
 * Wiki-Generierungs-Pipeline
 *
 * 1. extractCandidates  – LLM scannt Dokument → Entities + Concepts
 * 2. generateSummary     – LLM schreibt Wiki-Artikel mit [[links]]
 * 3. reduceEntitiesConcepts – Entity/Concept-Seiten anlegen/updaten
 * 4. injectCrossLinks    – Automatische Links in bestehenden Seiten
 * 5. updateIndexIntro    – Index-Intro aktualisieren
 */

import { db } from "../db/index.ts";
import {
  documents,
  wikiPages,
  modelProviders,
  workspaces,
  chunks,
} from "../db/schema.ts";
import { eq, and, inArray } from "drizzle-orm";
import {
  WIKI_CANDIDATE_SLUG_PROMPT,
  WIKI_SUMMARY_PROMPT,
  WIKI_PAGE_MODIFY_PROMPT,
  WIKI_DEDUP_PROMPT,
  WIKI_INDEX_INTRO_PROMPT,
} from "./wiki-prompts.ts";
import * as wikiService from "./wiki.ts";

// ---------------------------------------------------------------------------
// Typen
// ---------------------------------------------------------------------------

interface ExtractedItem {
  name: string;
  slug: string;
  aliases: string[];
  description: string;
  details: string;
}

interface CombinedExtraction {
  entities: ExtractedItem[];
  concepts: ExtractedItem[];
}

interface WikiResult {
  slug: string;
  title: string;
  summary: string;
  content: string;
  page_type: string;
  source_chunks?: string[];
}

// ---------------------------------------------------------------------------
// Hauptfunktion
// ---------------------------------------------------------------------------

export async function generateWikiArticles(
  docId: string,
  workspaceId: string,
): Promise<{ summary: any; entities: number; concepts: number } | null> {
  const t0 = Date.now();
  console.log(`[wiki-gen] ========== START ==========`);
  console.log(`[wiki-gen] Dokument: ${docId}, Workspace: ${workspaceId}`);

  // 1. Dokument laden
  const [doc] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, docId))
    .limit(1);

  if (!doc || !doc.content) {
    console.log(`[wiki-gen] ❌ Dokument nicht gefunden oder leer`);
    return null;
  }

  // 2. Aktiven Chat-Provider laden
  const provider = await getActiveProvider();
  if (!provider) {
    console.log(`[wiki-gen] ❌ Kein Chat-Provider konfiguriert`);
    return null;
  }

  // 3. Workspace-Konfiguration laden
  const [ws] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  const language = ws?.wiki_config?.wiki_language || "de";

  // 4. Existierende Slugs laden (für Deduplizierung)
  const existingPages = await wikiService.listPages(workspaceId, {
    page_size: 500,
  });
  const existingSlugs = existingPages.pages.map((p) => p.slug);

  // Content kürzen falls zu lang
  const content =
    doc.content.length > 32000
      ? doc.content.slice(0, 32000) + "\n\n[...](gekürzt)"
      : doc.content;

  // =========================================================================
  // SCHRITT 1: Kandidaten extrahieren (Entities + Concepts)
  // =========================================================================
  console.log(`[wiki-gen] 🔍 Schritt 1: Extrahiere Kandidaten...`);

  const candidateSlugs = existingPages.pages
    .filter((p) => p.page_type === "entity" || p.page_type === "concept")
    .map((p) => `[[${p.slug}|${p.title}]]`);

  const extractionJson = await callLLMJson<CombinedExtraction>(
    provider,
    WIKI_CANDIDATE_SLUG_PROMPT.replace("{{content}}", content)
      .replace("{{language}}", language)
      .replace("{{previousSlugs}}", candidateSlugs.join("\n") || "Keine"),
  );

  if (!extractionJson) {
    console.log(`[wiki-gen] ⚠️ Keine Kandidaten extrahiert`);
    return null;
  }

  const entities = extractionJson.entities || [];
  const concepts = extractionJson.concepts || [];
  console.log(
    `[wiki-gen] ✅ ${entities.length} Entities, ${concepts.length} Concepts gefunden`,
  );

  // =========================================================================
  // SCHRITT 2: Summary-Artikel generieren
  // =========================================================================
  console.log(`[wiki-gen] 📝 Schritt 2: Generiere Summary-Artikel...`);

  const allCandidates = [...entities, ...concepts];
  const extractedSlugsText = allCandidates
    .map((e) => `  - [[${e.slug}|${e.name}]]`)
    .join("\n");

  const summaryRaw = await callLLM(
    provider,
    WIKI_SUMMARY_PROMPT.replace("{{content}}", content)
      .replace("{{language}}", language)
      .replace("{{extractedSlugs}}", extractedSlugsText || "Keine"),
  );

  if (!summaryRaw) {
    console.log(`[wiki-gen] ❌ Summary-Generierung fehlgeschlagen`);
    return null;
  }

  // Summary parsen: "SUMMARY: ..." Zeile extrahieren
  const summaryMatch = summaryRaw.match(/SUMMARY:\s*(.+)/im);
  const summaryLine = summaryMatch ? summaryMatch[1].trim() : "";
  let summaryContent = summaryRaw.replace(/SUMMARY:\s*.+(\r?\n|$)/i, "").trim();

  const summaryTitleMatch = summaryContent.match(/^#\s+(.+)/m);
  const summaryTitle = summaryTitleMatch
    ? summaryTitleMatch[1].trim()
    : doc.title;

  console.log(
    `[wiki-gen] ✅ Summary: "${summaryTitle}" (${summaryContent.length} Zeichen)`,
  );

  // Summary-Seite erstellen
  const summarySlug = slugify(`summary-${doc.id}`);
  let summaryPage;
  const existingSummary = await wikiService.getPage(workspaceId, summarySlug);
  if (existingSummary) {
    summaryPage = await wikiService.updatePage(workspaceId, summarySlug, {
      title: summaryTitle,
      content: summaryContent,
      summary: summaryLine,
      page_type: "summary",
    });
  } else {
    summaryPage = await wikiService.createPage({
      workspace_id: workspaceId,
      slug: summarySlug,
      title: summaryTitle,
      content: summaryContent,
      summary: summaryLine,
      page_type: "summary",
      source_document_id: docId,
    });
  }

  // =========================================================================
  // SCHRITT 3: Entity/Concept-Seiten anlegen/updaten (Reduce)
  // =========================================================================
  console.log(`[wiki-gen] 🔗 Schritt 3: Entity/Concept-Seiten reduzieren...`);

  let entityCount = 0;
  let conceptCount = 0;

  for (const item of allCandidates) {
    const existing = await wikiService.getPage(workspaceId, item.slug);

    if (existing) {
      // Bestehende Seite mit neuen Infos mergen
      const mergePrompt = buildMergePrompt(
        existing,
        item,
        summaryContent,
        language,
        existingSlugs,
      );
      const mergedRaw = await callLLM(provider, mergePrompt);
      if (mergedRaw) {
        const mergedSummary = mergedRaw.match(/SUMMARY:\s*(.+)/im);
        const mergedContent = mergedRaw
          .replace(/SUMMARY:\s*.+(\r?\n|$)/i, "")
          .trim();
        await wikiService.updatePage(workspaceId, item.slug, {
          title: existing.title,
          content: mergedContent,
          summary: mergedSummary?.[1]?.trim() || item.description,
          page_type: item.slug.startsWith("entity/") ? "entity" : "concept",
        });
      }
    } else {
      // Neue Seite erstellen
      const pageContent = `# ${item.name}\n\n${item.details}\n\n## Quellen\n- [[${summarySlug}|${summaryTitle}]]`;
      const page = await wikiService.createPage({
        workspace_id: workspaceId,
        slug: item.slug,
        title: item.name,
        content: pageContent,
        summary: item.description,
        page_type: item.slug.startsWith("entity/") ? "entity" : "concept",
        source_document_id: docId,
      });

      // Aliases setzen
      if (item.aliases?.length > 0) {
        await db
          .update(wikiPages)
          .set({ aliases: item.aliases })
          .where(eq(wikiPages.id, page.id));
      }

      if (item.slug.startsWith("entity/")) entityCount++;
      else conceptCount++;
    }
  }

  // =========================================================================
  // SCHRITT 4: Cross-Links injizieren
  // =========================================================================
  console.log(`[wiki-gen] 🔄 Schritt 4: Injiziere Cross-Links...`);

  // Alle betroffenen Slugs = Summary + neue Entities/Concepts
  const affectedSlugs = [summarySlug, ...allCandidates.map((e) => e.slug)];

  // Für jede betroffene Seite: Links von anderen Seiten einfügen
  for (const slug of affectedSlugs) {
    const page = await wikiService.getPage(workspaceId, slug);
    if (!page || !page.content) continue;

    const refs = allCandidates
      .filter((c) => c.slug !== slug) // nicht auf sich selbst verlinken
      .map((c) => ({ slug: c.slug, matchText: c.name }));

    let changed = false;
    let newContent = page.content;

    for (const ref of refs) {
      // Einfache Link-Injection: erstes Vorkommen des Namens durch [[slug|name]] ersetzen
      const linkSyntax = `[[${ref.slug}|${ref.matchText}]]`;
      if (newContent.includes(linkSyntax)) continue;
      if (newContent.includes(`[[${ref.slug}]]`)) continue;

      const idx = newContent.indexOf(ref.matchText);
      if (idx >= 0) {
        // Prüfen ob bereits in einem [[...]] oder Code-Block
        const before = newContent.slice(Math.max(0, idx - 2), idx);
        const after = newContent.slice(
          idx + ref.matchText.length,
          idx + ref.matchText.length + 2,
        );
        if (!before.includes("[[") && !after.includes("]]")) {
          newContent =
            newContent.slice(0, idx) +
            linkSyntax +
            newContent.slice(idx + ref.matchText.length);
          changed = true;
        }
      }
    }

    if (changed) {
      await wikiService.updatePage(workspaceId, slug, { content: newContent });
    }
  }

  // =========================================================================
  // SCHRITT 5: Index-Intro aktualisieren
  // =========================================================================
  console.log(`[wiki-gen] 📋 Schritt 5: Aktualisiere Index-Intro...`);

  const indexPage = await wikiService.getPage(workspaceId, "index");
  if (!indexPage || !indexPage.content) {
    // Index neu erstellen
    const stats = await wikiService.getStats(workspaceId);
    const indexIntro = `# Wiki Index\n\nDieses Wiki enthält ${stats.total_pages} Seiten aus importierten Dokumenten.`;
    await wikiService.createPage({
      workspace_id: workspaceId,
      slug: "index",
      title: "Wiki Index",
      content: indexIntro,
      summary: indexIntro,
      page_type: "index",
    });
  }

  console.log(`[wiki-gen] ========== ENDE (${Date.now() - t0}ms) ==========`);

  return {
    summary: summaryPage,
    entities: entityCount,
    concepts: conceptCount,
  };
}

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

function buildMergePrompt(
  existing: any,
  item: ExtractedItem,
  summaryContent: string,
  language: string,
  existingSlugs: string[],
): string {
  const availableSlugs = [...existingSlugs, item.slug]
    .map((s) => `[[${s}]]`)
    .join("\n");

  return WIKI_PAGE_MODIFY_PROMPT.replace("{{pageSlug}}", item.slug)
    .replace("{{pageTitle}}", item.name)
    .replace(
      "{{pageType}}",
      item.slug.startsWith("entity/") ? "Entität" : "Konzept",
    )
    .replace("{{pageAliases}}", (item.aliases || []).join(", "))
    .replace("{{existingContent}}", existing.content || "")
    .replace("{{availableSlugs}}", availableSlugs)
    .replace("{{language}}", language)
    .replace(
      "{{additionsSection}}",
      `\n<new_information>\n${summaryContent}\n</new_information>\n`,
    )
    .replace("{{retractionsSection}}", "")
    .replace("{{retractionInstructions}}", "")
    .replace(
      "{{additionInstructions}}",
      `3. FÜGE die Fakten aus <new_information> in die Seite ein, wenn sie über ${item.name} handeln.\n`,
    )
    .replace("{{emptyPageInstruction}}", "");
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9äöüß\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 200);
}

async function getActiveProvider() {
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

async function callLLM(provider: any, prompt: string): Promise<string | null> {
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
      console.warn(
        `[wiki-gen] LLM error ${response.status}: ${err.slice(0, 200)}`,
      );
      return null;
    }

    const data = await response.json();
    return data?.choices?.[0]?.message?.content || null;
  } catch (e: any) {
    console.warn(`[wiki-gen] LLM call failed: ${e.message}`);
    return null;
  }
}

async function callLLMJson<T>(
  provider: any,
  prompt: string,
): Promise<T | null> {
  const raw = await callLLM(provider, prompt);
  if (!raw) return null;

  // JSON aus der Antwort extrahieren (zwischen { und })
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as T;
    }
    return JSON.parse(raw) as T;
  } catch (e: any) {
    console.warn(`[wiki-gen] JSON parse failed: ${e.message}`);
    return null;
  }
}
