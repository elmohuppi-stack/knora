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
  WIKI_CHUNK_CITATION_PROMPT,
  granularityGuidance,
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

interface Chapter {
  title: string;
  text: string;
}

// Zielgröße pro Kapitel in Zeichen (~10-15 Seiten) – das Fenster, das die
// Summary-/Extraktions-Prompts zuverlässig als Ganzes verarbeiten. Über
// WIKI_CHAPTER_CHARS konfigurierbar.
const CHAPTER_CHARS = parseInt(process.env.WIKI_CHAPTER_CHARS || "32000");

// Wiki-Tiefe-Steuerung (kombiniert Auto-Deckel + Summary-only in EINER Einstellung
// wiki_config.wiki_depth). Harte Obergrenze für Entity/Concept-Seiten pro Import im
// Modus "capped" – verhindert die Seiten-Explosion bei großen Dokumenten.
const WIKI_MAX_PAGES_CEILING = parseInt(
  process.env.WIKI_MAX_PAGES_CEILING || "120",
);
// Ab so vielen Kapiteln stuft der Default-Modus "capped" automatisch auf
// summary-only herunter (nur Kapitel-Artikel, keine teuren Entity/Concept-Seiten),
// um Stunden-Läufe/Kostenexplosion bei Riesen-Dokumenten zu vermeiden.
const WIKI_SUMMARY_ONLY_CHAPTERS = parseInt(
  process.env.WIKI_SUMMARY_ONLY_CHAPTERS || "25",
);

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
  const granularity = ws?.wiki_config?.extraction_granularity || "standard";
  const maxPages = ws?.wiki_config?.max_pages_per_ingest || 10;

  // Wiki-Tiefe: "full" (alles, kein Deckel) | "capped" (Entity/Concept-Seiten,
  // gedeckelt + Auto-Summary bei sehr großen Docs) | "summary" (nur Kapitel-Artikel)
  // | "off" (kein Wiki – Dokument ist trotzdem via Chat/RAG durchsuchbar).
  // Default "capped": sinnvoll bounded ohne manuelles Konfigurieren.
  const wikiDepth = ws?.wiki_config?.wiki_depth || "capped";
  if (wikiDepth === "off") {
    console.log(`[wiki-gen] ⏭️ wiki_depth="off" – Wiki-Generierung übersprungen`);
    return null;
  }

  // 4. Existierende Slugs laden (für Deduplizierung)
  const existingPages = await wikiService.listPages(workspaceId, {
    page_size: 500,
  });
  const existingSlugs = existingPages.pages.map((p) => p.slug);

  // Dokument in Kapitel (~CHAPTER_CHARS) zerlegen, damit das GANZE Dokument
  // verarbeitet wird statt bei 32k Zeichen abgeschnitten. Kurze Dokumente ergeben
  // genau ein Kapitel = bisheriges Verhalten.
  const chapters = splitIntoChapters(doc.content, CHAPTER_CHARS);
  const multiChapter = chapters.length > 1;
  console.log(
    `[wiki-gen] 📖 Dokument in ${chapters.length} Kapitel zerlegt (~${CHAPTER_CHARS} Zeichen/Kapitel)`,
  );

  // Effektive Tiefe: Im Default-Modus "capped" sehr große Dokumente automatisch auf
  // summary-only herunterstufen. "full" bleibt bewusst unangetastet (Power-User).
  let depth = wikiDepth;
  if (depth === "capped" && chapters.length >= WIKI_SUMMARY_ONLY_CHAPTERS) {
    depth = "summary";
    console.log(
      `[wiki-gen] ⚙️ ${chapters.length} Kapitel ≥ ${WIKI_SUMMARY_ONLY_CHAPTERS} → Auto-Summary-Modus (keine Entity/Concept-Seiten)`,
    );
  }
  // Entity/Concept-Seiten nur in "full"/"capped"; "summary" erzeugt nur Kapitel.
  const generatePages = depth === "full" || depth === "capped";

  // Seiten-Budget pro Kapitel skalieren: "full" unbegrenzt (maxPages × Kapitel),
  // "capped" zusätzlich hart gedeckelt gegen die Seiten-Explosion.
  const effectiveMaxPages =
    depth === "capped"
      ? Math.min(WIKI_MAX_PAGES_CEILING, maxPages * chapters.length)
      : maxPages * chapters.length;

  console.log(`[wiki-gen] 🎚️ Wiki-Tiefe: ${depth} (konfiguriert: ${wikiDepth})`);

  const previousSlugs = existingPages.pages
    .filter((p) => p.page_type === "entity" || p.page_type === "concept")
    .map((p) => `[[${p.slug}|${p.title}]]`)
    .join("\n");

  // =========================================================================
  // SCHRITT 1: Kandidaten extrahieren (Entities + Concepts) – über ALLE Kapitel
  // Im Summary-Modus übersprungen (keine Entity/Concept-Seiten → keine Extraktion
  // nötig; spart bei großen Dokumenten die teuersten Zusatz-Calls).
  // =========================================================================
  const candidateMap = new Map<string, ExtractedItem>();
  if (generatePages) {
    console.log(
      `[wiki-gen] 🔍 Schritt 1: Extrahiere Kandidaten aus ${chapters.length} Kapitel(n)...`,
    );
    for (let i = 0; i < chapters.length; i++) {
      const extractionJson = await callLLMJson<CombinedExtraction>(
        provider,
        WIKI_CANDIDATE_SLUG_PROMPT.replace("{{content}}", chapters[i].text)
          .replace(/\{\{language\}\}/g, language)
          .replace("{{previousSlugs}}", previousSlugs || "Keine")
          .replace("{{granularityGuidance}}", granularityGuidance(granularity)),
      );
      if (!extractionJson) continue;
      for (const it of [
        ...(extractionJson.entities || []),
        ...(extractionJson.concepts || []),
      ]) {
        mergeCandidate(candidateMap, it);
      }
    }
    console.log(
      `[wiki-gen] ✅ ${candidateMap.size} Kandidaten (dedupliziert über alle Kapitel)`,
    );
  } else {
    console.log(`[wiki-gen] ⏭️ Schritt 1 übersprungen (Summary-Modus)`);
  }

  const allCandidates = [...candidateMap.values()];
  const extractedSlugsText = allCandidates
    .map((e) => `  - [[${e.slug}|${e.name}]]`)
    .join("\n");

  // =========================================================================
  // SCHRITT 2: Kapitel-Artikel generieren (+ Übersichtsseite bei mehreren Kapiteln)
  // =========================================================================
  console.log(
    `[wiki-gen] 📝 Schritt 2: Generiere ${chapters.length} Kapitel-Artikel...`,
  );

  const baseSlug = slugify(`summary-${doc.id}`);
  const chapterSlugs: string[] = [];
  const chapterLinks: string[] = [];
  let summaryPage: any = null;

  for (let i = 0; i < chapters.length; i++) {
    const chapter = chapters[i];
    const summaryRaw = await callLLM(
      provider,
      WIKI_SUMMARY_PROMPT.replace("{{content}}", chapter.text)
        .replace("{{language}}", language)
        .replace("{{extractedSlugs}}", extractedSlugsText || "Keine"),
    );
    if (!summaryRaw) {
      console.log(`[wiki-gen] ⚠️ Kapitel ${i + 1}: Summary fehlgeschlagen`);
      continue;
    }

    const sumMatch = summaryRaw.match(/SUMMARY:\s*(.+)/im);
    const summaryLine = sumMatch ? sumMatch[1].trim() : "";
    const body = summaryRaw.replace(/SUMMARY:\s*.+(\r?\n|$)/i, "").trim();
    // Titel-Priorität: echte Dokument-Überschrift → vom LLM generierter Artikel-
    // titel (# …) → generischer Fallback. So bekommen auch PDFs ohne Markdown-
    // Überschriften aussagekräftige Kapitel-Titel statt "Kapitel N".
    const titleMatch = body.match(/^#\s+(.+)/m);
    const chapterTitle =
      chapter.title ||
      (titleMatch
        ? titleMatch[1].trim()
        : multiChapter
          ? `${doc.title} – Teil ${i + 1}`
          : doc.title);

    // Bei mehreren Kapiteln eindeutiger Slug pro Kapitel; bei einem Kapitel der
    // bisherige Summary-Slug (Rückwärtskompatibilität + sauberer Re-Import).
    const chapterSlug = multiChapter ? `${baseSlug}-k${i + 1}` : baseSlug;

    const page = await upsertPage(workspaceId, chapterSlug, {
      title: chapterTitle,
      content: body,
      summary: summaryLine,
      page_type: "summary",
      source_document_id: docId,
    });
    chapterSlugs.push(chapterSlug);
    chapterLinks.push(`- [[${chapterSlug}|${chapterTitle}]]`);
    if (!summaryPage) summaryPage = page;
    console.log(
      `[wiki-gen] ✅ Kapitel ${i + 1}/${chapters.length}: "${chapterTitle}" (${body.length} Zeichen)`,
    );
  }

  // Übersichtsseite mit Inhaltsverzeichnis (nur bei mehreren Kapiteln). Behält den
  // Basis-Slug, sodass Verlinkungen auf "das Dokument" auf die Übersicht zeigen.
  if (multiChapter) {
    const overviewContent =
      `# ${doc.title}\n\n` +
      `Dieses Dokument ist in ${chapters.length} Kapitel gegliedert.\n\n` +
      `## Kapitel\n\n${chapterLinks.join("\n")}`;
    summaryPage = await upsertPage(workspaceId, baseSlug, {
      title: doc.title,
      content: overviewContent,
      summary: `Übersicht über ${chapters.length} Kapitel aus „${doc.title}".`,
      page_type: "summary",
      source_document_id: docId,
    });
  }

  // =========================================================================
  // SCHRITT 3: Chunk-Citation – ordne jedem Kandidaten seine Quell-Chunks zu
  // =========================================================================
  console.log(`[wiki-gen] 📎 Schritt 3: Chunk-Citation...`);

  // Quell-Chunks des Dokuments laden (chunk_index-Reihenfolge, globale [cNNN]-Labels)
  const sourceChunks = await loadSourceChunks(docId);
  const chunkByLabel = new Map<string, { id: string; content: string }>();
  sourceChunks.forEach((c) => chunkByLabel.set(c.label, c));

  // Aggregierte Zuordnung: slug -> Set<label>
  const citationsBySlug = new Map<string, Set<string>>();

  if (sourceChunks.length > 0 && allCandidates.length > 0) {
    const candidateList = allCandidates
      .map((c) => `- ${c.slug}: ${c.name}`)
      .join("\n");
    // Kein Batch-Deckel: alle Chunks des Dokuments werden zitiert, damit auch
    // Entitäten/Konzepte aus dem hinteren Teil des Dokuments echte Quell-Zitate
    // erhalten (früher nur die ersten 4 Batches ≈ 48k Zeichen).
    const batches = buildCitationBatches(
      sourceChunks,
      12000,
      Number.MAX_SAFE_INTEGER,
    );

    for (const batch of batches) {
      const chunksXml = batch
        .map((c) => `<c id="${c.label}">\n${c.content}\n</c>`)
        .join("\n");
      const citeJson = await callLLMJson<CitationResult>(
        provider,
        WIKI_CHUNK_CITATION_PROMPT.replace("{{candidateSlugs}}", candidateList)
          .replace("{{chunksXml}}", chunksXml)
          .replace(/\{\{language\}\}/g, language),
      );
      if (!citeJson) continue;

      // Zitate übernehmen
      for (const [slug, labels] of Object.entries(citeJson.citations || {})) {
        if (!Array.isArray(labels)) continue;
        const set = citationsBySlug.get(slug) || new Set<string>();
        labels.forEach((l) => {
          if (chunkByLabel.has(l)) set.add(l);
        });
        citationsBySlug.set(slug, set);
      }

      // Neu entdeckte Slugs aufnehmen (Nachentdeckung fehlender Konzepte)
      for (const ns of citeJson.new_slugs || []) {
        if (!ns?.slug || !ns?.name) continue;
        if (allCandidates.some((c) => c.slug === ns.slug)) continue;
        allCandidates.push({
          name: ns.name,
          slug: ns.slug,
          aliases: ns.aliases || [],
          description: ns.description || "",
          details: ns.details || "",
        });
        const set = citationsBySlug.get(ns.slug) || new Set<string>();
        (ns.source_chunks || []).forEach((l) => {
          if (chunkByLabel.has(l)) set.add(l);
        });
        citationsBySlug.set(ns.slug, set);
      }
    }
  }

  const citedCount = [...citationsBySlug.values()].filter(
    (s) => s.size > 0,
  ).length;
  console.log(
    `[wiki-gen] ✅ ${citedCount}/${allCandidates.length} Kandidaten mit Chunk-Zitaten`,
  );

  // =========================================================================
  // SCHRITT 4: Entity/Concept-Seiten kompilieren (Reduce, per LLM)
  // =========================================================================
  console.log(`[wiki-gen] 🔗 Schritt 4: Entity/Concept-Seiten kompilieren...`);

  let entityCount = 0;
  let conceptCount = 0;

  // Kandidaten mit den meisten Zitaten zuerst, auf maxPages begrenzen
  const prioritized = [...allCandidates].sort(
    (a, b) =>
      (citationsBySlug.get(b.slug)?.size || 0) -
      (citationsBySlug.get(a.slug)?.size || 0),
  );
  const toProcess = prioritized.slice(0, effectiveMaxPages);
  if (prioritized.length > effectiveMaxPages) {
    console.log(
      `[wiki-gen] ⚠️ ${prioritized.length} Kandidaten, begrenze auf ${effectiveMaxPages} (max_pages_per_ingest ${maxPages} × ${chapters.length} Kapitel)`,
    );
  }

  for (const item of toProcess) {
    const existing = await wikiService.getPage(workspaceId, item.slug);

    // <new_information> aus zitierten Chunks (wörtlich) bauen; Fallback: details
    const labels = [...(citationsBySlug.get(item.slug) || [])];
    const citedIds: string[] = [];
    let newInfo: string;
    if (labels.length > 0) {
      newInfo =
        `**${item.name}**: ${item.description}\n\n` +
        labels
          .map((l) => {
            const c = chunkByLabel.get(l)!;
            citedIds.push(c.id);
            return `[${l}] ${c.content}`;
          })
          .join("\n\n");
    } else {
      // Kein Zitat gefunden – Fallback auf Kurzbeschreibung + Details
      newInfo = `**${item.name}**: ${item.description}\n\n${item.details}`;
    }

    const pagePrompt = buildPagePrompt({
      item,
      existingContent: existing?.content || "(Neue Seite)",
      newInformation: newInfo,
      language,
      availableSlugs: existingSlugs,
    });
    const raw = await callLLM(provider, pagePrompt);
    if (!raw) continue;

    const sumMatch = raw.match(/SUMMARY:\s*(.+)/im);
    const body = raw.replace(/SUMMARY:\s*.+(\r?\n|$)/i, "").trim();
    const pageType = item.slug.startsWith("entity/") ? "entity" : "concept";

    if (existing) {
      await wikiService.updatePage(workspaceId, item.slug, {
        title: existing.title,
        content: body,
        summary: sumMatch?.[1]?.trim() || item.description,
        page_type: pageType,
      });
      await mergeChunkRefs(existing.id, citedIds);
    } else {
      const page = await wikiService.createPage({
        workspace_id: workspaceId,
        slug: item.slug,
        title: item.name,
        content: body,
        summary: sumMatch?.[1]?.trim() || item.description,
        page_type: pageType,
        source_document_id: docId,
      });
      const patch: Record<string, any> = {};
      if (item.aliases?.length > 0) patch.aliases = item.aliases;
      if (citedIds.length > 0) patch.chunk_refs = [...new Set(citedIds)];
      if (Object.keys(patch).length > 0) {
        await db.update(wikiPages).set(patch).where(eq(wikiPages.id, page.id));
      }
    }

    // Zählt erstellte UND aktualisierte Seiten (Slugs sind workspace-global,
    // bei Re-Import laufen bestehende Seiten über den Merge-Zweig)
    if (pageType === "entity") entityCount++;
    else conceptCount++;
  }

  // =========================================================================
  // SCHRITT 5: Cross-Links injizieren
  // =========================================================================
  console.log(`[wiki-gen] 🔄 Schritt 5: Injiziere Cross-Links...`);

  // Nur Seiten, die tatsächlich erstellt/aktualisiert wurden (verhindert tote Links).
  // Die Übersichtsseite (baseSlug bei mehreren Kapiteln) bleibt bewusst außen vor –
  // ihr Inhalt ist ein kontrolliertes Inhaltsverzeichnis, keine Fließtext-Seite.
  const affectedSlugs = [...chapterSlugs, ...toProcess.map((e) => e.slug)];

  // Gültige Ziel-Slugs (für Dead-Link-Bereinigung) einmalig laden
  const allPages = await wikiService.listPages(workspaceId, { page_size: 1000 });
  const validSlugSet = new Set(allPages.pages.map((p) => p.slug));

  // Für jede betroffene Seite: Links von anderen Seiten einfügen + tote Links entfernen
  for (const slug of affectedSlugs) {
    const page = await wikiService.getPage(workspaceId, slug);
    if (!page || !page.content) continue;

    const refs = toProcess
      .filter((c) => c.slug !== slug) // nicht auf sich selbst verlinken
      .map((c) => ({ slug: c.slug, matchText: c.name }));

    let newContent = injectCrossLinks(page.content, refs);
    newContent = stripDeadLinks(newContent, validSlugSet);

    if (newContent !== page.content) {
      await wikiService.updatePage(workspaceId, slug, { content: newContent });
    }
  }

  // =========================================================================
  // SCHRITT 6: Index-Intro aktualisieren
  // =========================================================================
  console.log(`[wiki-gen] 📋 Schritt 6: Aktualisiere Index-Intro...`);

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

  // Neu erzeugte Wiki-Chunks embedden, damit sie in der Vektorsuche (Chat-RAG)
  // auffindbar sind (nicht-blockierend – hält den Wiki-Gen-Response nicht auf).
  import("./embedding.ts")
    .then(({ embedWorkspaceChunks }) =>
      embedWorkspaceChunks(workspaceId).then((r) =>
        console.log(`[wiki-gen] 🧠 ${r.processed} Wiki-Chunks embedded`),
      ),
    )
    .catch((e) => console.warn(`[wiki-gen] Embedding-Trigger fehlgeschlagen:`, e));

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

/**
 * Zerlegt langen Dokumenttext in Kapitel von je ~targetChars Zeichen. Bevorzugt
 * Schnitte an Markdown-Überschriften (# / ## / ###) und packt aufeinanderfolgende
 * Abschnitte bis zur Zielgröße; ohne Überschriften greift ein Größen-Fallback an
 * Absatzgrenzen. Kurze Dokumente ergeben genau EIN Kapitel (= bisheriges Verhalten).
 */
function splitIntoChapters(content: string, targetChars: number): Chapter[] {
  const text = content.trim();
  if (text.length <= targetChars) {
    return [{ title: "", text }];
  }

  const headingRe = /^#{1,3}\s+.+$/gm;
  const matches = [...text.matchAll(headingRe)];

  // Keine Überschriften: reiner Größen-Fallback an Absatzgrenzen. Titel bleibt leer
  // – der Kapitel-Titel wird später aus dem LLM-generierten Artikel abgeleitet.
  if (matches.length === 0) {
    return packBySize(text, targetChars).map((t) => ({ title: "", text: t }));
  }

  // In Abschnitte zerlegen (jede Überschrift startet einen neuen Abschnitt).
  const sections: { heading: string; body: string }[] = [];
  const firstIdx = matches[0].index!;
  if (firstIdx > 0) {
    const pre = text.slice(0, firstIdx).trim();
    if (pre) sections.push({ heading: "", body: pre });
  }
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index!;
    const end = i + 1 < matches.length ? matches[i + 1].index! : text.length;
    sections.push({
      heading: matches[i][0].replace(/^#{1,3}\s+/, "").trim(),
      body: text.slice(start, end),
    });
  }

  // Abschnitte in Kapitel bis targetChars packen.
  const chapters: Chapter[] = [];
  let curText = "";
  let curTitle = "";
  const flush = () => {
    if (curText.trim()) {
      // Leerer Titel = keine echte Überschrift gefunden; wird später aus dem
      // LLM-Artikel oder als "Titel – Teil N" abgeleitet.
      chapters.push({ title: curTitle, text: curText.trim() });
    }
    curText = "";
    curTitle = "";
  };

  for (const sec of sections) {
    // Einzelabschnitt größer als das Fenster: hart nach Größe splitten.
    if (sec.body.length > targetChars) {
      flush();
      const parts = packBySize(sec.body, targetChars);
      parts.forEach((p, i) => {
        chapters.push({
          title: sec.heading
            ? i === 0
              ? sec.heading
              : `${sec.heading} (Teil ${i + 1})`
            : "",
          text: p.trim(),
        });
      });
      continue;
    }
    if (curText && curText.length + sec.body.length > targetChars) {
      flush();
    }
    if (!curTitle && sec.heading) curTitle = sec.heading;
    curText += (curText ? "\n\n" : "") + sec.body;
  }
  flush();
  return chapters;
}

/** Packt Text an Absatzgrenzen (\n\n) in Stücke ≤ maxChars; harte Notbremse bei Übergröße. */
function packBySize(text: string, maxChars: number): string[] {
  const paras = text.split(/\n\n+/);
  const out: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (p.length > maxChars) {
      if (cur) {
        out.push(cur);
        cur = "";
      }
      for (let i = 0; i < p.length; i += maxChars) {
        out.push(p.slice(i, i + maxChars));
      }
      continue;
    }
    if (cur && cur.length + p.length + 2 > maxChars) {
      out.push(cur);
      cur = "";
    }
    cur += (cur ? "\n\n" : "") + p;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** Führt einen extrahierten Kandidaten dedupliziert (per Slug) in die Sammlung ein. */
function mergeCandidate(map: Map<string, ExtractedItem>, it: ExtractedItem) {
  if (!it?.slug || !it?.name) return;
  const ex = map.get(it.slug);
  if (!ex) {
    map.set(it.slug, {
      name: it.name,
      slug: it.slug,
      aliases: it.aliases || [],
      description: it.description || "",
      details: it.details || "",
    });
    return;
  }
  ex.aliases = [...new Set([...(ex.aliases || []), ...(it.aliases || [])])];
  // Längste Beschreibung/Details behalten (die Substanz kommt ohnehin aus den
  // zitierten Chunks; description/details sind nur Startpunkt/Fallback).
  if ((it.description || "").length > (ex.description || "").length) {
    ex.description = it.description;
  }
  if ((it.details || "").length > (ex.details || "").length) {
    ex.details = it.details;
  }
}

/** Legt eine Wiki-Seite an oder aktualisiert sie, falls der Slug schon existiert. */
async function upsertPage(
  workspaceId: string,
  slug: string,
  data: {
    title: string;
    content: string;
    summary: string;
    page_type: string;
    source_document_id?: string;
  },
) {
  const existing = await wikiService.getPage(workspaceId, slug);
  if (existing) {
    return await wikiService.updatePage(workspaceId, slug, {
      title: data.title,
      content: data.content,
      summary: data.summary,
      page_type: data.page_type,
    });
  }
  return await wikiService.createPage({
    workspace_id: workspaceId,
    slug,
    title: data.title,
    content: data.content,
    summary: data.summary,
    page_type: data.page_type,
    source_document_id: data.source_document_id,
  });
}

function buildPagePrompt(opts: {
  item: ExtractedItem;
  existingContent: string;
  newInformation: string;
  language: string;
  availableSlugs: string[];
}): string {
  const { item, existingContent, newInformation, language, availableSlugs } =
    opts;
  const pageType = item.slug.startsWith("entity/") ? "Entität" : "Konzept";
  const validLinks = [...new Set(availableSlugs)]
    .filter((s) => s !== item.slug) // Seite verlinkt nicht auf sich selbst
    .map((s) => `[[${s}]]`)
    .join("\n");

  return WIKI_PAGE_MODIFY_PROMPT.replace(/\{\{pageSlug\}\}/g, item.slug)
    .replace(/\{\{pageTitle\}\}/g, item.name)
    .replace(/\{\{pageType\}\}/g, pageType)
    .replace("{{pageAliases}}", (item.aliases || []).join(", "))
    .replace("{{existingContent}}", existingContent)
    .replace("{{availableSlugs}}", validLinks || "Keine")
    .replace(/\{\{language\}\}/g, language)
    .replace(
      "{{additionsSection}}",
      `<new_information>\n${newInformation}\n</new_information>`,
    )
    .replace("{{retractionsSection}}", "")
    .replace("{{retractionInstructions}}", "")
    .replace(
      "{{additionInstructions}}",
      `2. KOMPILIERE die Fakten aus <new_information> zu einem vollständigen, gut gegliederten Artikel über ${item.name}. Verarbeite JEDEN [cNNN]-Chunk und behalte die [cNNN]-Zitate bei.\n3. Erhalte bestehende, weiterhin gültige Informationen über ${item.name}.`,
    )
    .replace("{{emptyPageInstruction}}", "");
}

// ---------------------------------------------------------------------------
// Chunk-Citation-Helfer
// ---------------------------------------------------------------------------

interface CitationNewSlug {
  type?: string;
  name: string;
  slug: string;
  aliases?: string[];
  description?: string;
  details?: string;
  source_chunks?: string[];
}

interface CitationResult {
  citations: Record<string, string[]>;
  new_slugs: CitationNewSlug[];
}

/** Lädt die Quell-Chunks eines Dokuments und vergibt stabile [cNNN]-Labels. */
async function loadSourceChunks(
  docId: string,
): Promise<{ id: string; content: string; label: string }[]> {
  const rows = await db
    .select({
      id: chunks.id,
      content: chunks.content,
      idx: chunks.chunk_index,
    })
    .from(chunks)
    .where(eq(chunks.document_id, docId))
    .orderBy(chunks.chunk_index);

  return rows.map((r, i) => ({
    id: r.id,
    content: r.content,
    label: `c${String(i + 1).padStart(3, "0")}`,
  }));
}

/** Packt Chunks in Batches (≤ maxChars), begrenzt auf maxBatches LLM-Aufrufe. */
function buildCitationBatches(
  chunkList: { id: string; content: string; label: string }[],
  maxChars: number,
  maxBatches = 4,
): { id: string; content: string; label: string }[][] {
  const batches: { id: string; content: string; label: string }[][] = [];
  let current: { id: string; content: string; label: string }[] = [];
  let size = 0;

  for (const c of chunkList) {
    if (current.length > 0 && size + c.content.length > maxChars) {
      batches.push(current);
      if (batches.length >= maxBatches) return batches;
      current = [];
      size = 0;
    }
    current.push(c);
    size += c.content.length;
  }
  if (current.length > 0 && batches.length < maxBatches) batches.push(current);
  return batches;
}

/** Führt neue Chunk-Referenzen dedupliziert in die bestehende Seite ein. */
async function mergeChunkRefs(pageId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const [row] = await db
    .select({ chunk_refs: wikiPages.chunk_refs })
    .from(wikiPages)
    .where(eq(wikiPages.id, pageId))
    .limit(1);
  const existing = (row?.chunk_refs as string[]) || [];
  const merged = [...new Set([...existing, ...ids])];
  await db
    .update(wikiPages)
    .set({ chunk_refs: merged })
    .where(eq(wikiPages.id, pageId));
}

// ---------------------------------------------------------------------------
// Cross-Link-Helfer
// ---------------------------------------------------------------------------

const WORD_CHAR = /[\p{L}\p{N}_]/u;

/**
 * Injiziert [[slug|name]]-Links für das erste sichere Vorkommen jedes Kandidaten.
 * Sicher = nicht innerhalb eines bestehenden [[...]]-Links und an Wortgrenzen.
 * Ein Slug, der bereits (mit beliebigem Anzeigetext) verlinkt ist, wird
 * übersprungen – das verhindert verschachtelte/doppelte Links.
 */
function injectCrossLinks(
  content: string,
  refs: { slug: string; matchText: string }[],
): string {
  let out = content;

  for (const ref of refs) {
    if (!ref.matchText) continue;
    // Slug schon irgendwo verlinkt? (egal mit welchem Anzeigetext) -> überspringen
    if (out.includes(`[[${ref.slug}|`) || out.includes(`[[${ref.slug}]]`)) {
      continue;
    }

    // Geschützte Bereiche: bestehende [[...]]-Links
    const spans: Array<[number, number]> = [];
    const linkRe = /\[\[[^\]]*\]\]/g;
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(out)) !== null) {
      spans.push([m.index, m.index + m[0].length]);
    }

    // Erstes Vorkommen außerhalb geschützter Bereiche + an Wortgrenzen finden
    let from = 0;
    while (true) {
      const idx = out.indexOf(ref.matchText, from);
      if (idx < 0) break;
      const end = idx + ref.matchText.length;

      const inSpan = spans.some(([s, e]) => idx < e && end > s);
      const beforeChar = idx > 0 ? out[idx - 1] : "";
      const afterChar = end < out.length ? out[end] : "";
      const boundaryOk = !WORD_CHAR.test(beforeChar) && !WORD_CHAR.test(afterChar);

      if (!inSpan && boundaryOk) {
        out = out.slice(0, idx) + `[[${ref.slug}|${ref.matchText}]]` + out.slice(end);
        break;
      }
      from = idx + 1;
    }
  }

  return out;
}

/**
 * Entfernt [[slug|name]]- und [[slug]]-Links, deren Ziel-Seite nicht existiert,
 * und ersetzt sie durch den reinen Anzeigetext.
 */
function stripDeadLinks(content: string, validSlugs: Set<string>): string {
  return content.replace(
    /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
    (match, slug: string, text?: string) => {
      if (validSlugs.has(slug.trim())) return match;
      return text || slug.split("/").pop() || slug;
    },
  );
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
