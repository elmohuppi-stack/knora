import { db } from "../db/index.ts";
import { wikiPages, documents, modelProviders } from "../db/schema.ts";
import { eq, and, like, or, desc, sql, inArray } from "drizzle-orm";

// --- CRUD ---

export async function listPages(
  workspaceId: string,
  options?: {
    page_type?: string;
    query?: string;
    source_document_id?: string;
    page?: number;
    page_size?: number;
  },
) {
  const page = options?.page || 1;
  const pageSize = options?.page_size || 50;

  let conditions = eq(wikiPages.workspace_id, workspaceId);

  if (options?.page_type) {
    conditions = and(conditions, eq(wikiPages.page_type, options.page_type))!;
  }
  if (options?.query) {
    conditions = and(
      conditions,
      or(
        like(wikiPages.title, `%${options.query}%`),
        like(wikiPages.content, `%${options.query}%`),
      ),
    )!;
  }
  if (options?.source_document_id) {
    conditions = and(
      conditions,
      eq(wikiPages.source_document_id, options.source_document_id),
    )!;
  }

  const rows = await db
    .select()
    .from(wikiPages)
    .where(conditions)
    .orderBy(desc(wikiPages.updated_at))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const [countResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(wikiPages)
    .where(conditions);

  return {
    pages: rows,
    total: Number(countResult?.count || 0),
    page,
    page_size: pageSize,
  };
}

export async function getPage(workspaceId: string, slug: string) {
  const [page] = await db
    .select()
    .from(wikiPages)
    .where(
      and(eq(wikiPages.workspace_id, workspaceId), eq(wikiPages.slug, slug)),
    )
    .limit(1);
  return page || null;
}

export async function getPageById(id: string) {
  const [page] = await db
    .select()
    .from(wikiPages)
    .where(eq(wikiPages.id, id))
    .limit(1);
  return page || null;
}

export async function createPage(data: {
  workspace_id: string;
  slug: string;
  title: string;
  content?: string;
  summary?: string;
  page_type?: string;
  source_document_id?: string;
  created_by?: number;
}) {
  const [page] = await db
    .insert(wikiPages)
    .values({
      id: crypto.randomUUID(),
      workspace_id: data.workspace_id,
      slug: data.slug,
      title: data.title,
      content: data.content || "",
      summary: data.summary || "",
      page_type: data.page_type || "article",
      source_document_id: data.source_document_id || null,
      created_by: data.created_by || null,
    })
    .returning();
  return page;
}

export async function updatePage(
  workspaceId: string,
  slug: string,
  data: {
    title?: string;
    content?: string;
    summary?: string;
    page_type?: string;
    status?: string;
    out_links?: string[];
  },
) {
  const updateData: Record<string, any> = { updated_at: new Date() };
  if (data.title !== undefined) updateData.title = data.title;
  if (data.content !== undefined) updateData.content = data.content;
  if (data.summary !== undefined) updateData.summary = data.summary;
  if (data.page_type !== undefined) updateData.page_type = data.page_type;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.out_links !== undefined) updateData.out_links = data.out_links;
  if (data.content !== undefined) updateData.version = sql`version + 1`;

  const [page] = await db
    .update(wikiPages)
    .set(updateData)
    .where(
      and(eq(wikiPages.workspace_id, workspaceId), eq(wikiPages.slug, slug)),
    )
    .returning();
  return page || null;
}

export async function deletePage(workspaceId: string, slug: string) {
  // Auch eingehende Links bei anderen Seiten entfernen
  await db
    .update(wikiPages)
    .set({
      in_links: sql`array_remove(in_links, ${slug})`,
      updated_at: new Date(),
    })
    .where(
      and(
        eq(wikiPages.workspace_id, workspaceId),
        sql`${slug} = ANY(in_links)`,
      ),
    );

  await db
    .delete(wikiPages)
    .where(
      and(eq(wikiPages.workspace_id, workspaceId), eq(wikiPages.slug, slug)),
    );
}

// --- Wiki-Link Resolution ---

export async function resolveLinks(
  workspaceId: string,
  content: string,
): Promise<{ out_links: string[]; content: string }> {
  const linkRegex = /\[\[([^\]]+)\]\]/g;
  const slugs: string[] = [];
  let match;

  while ((match = linkRegex.exec(content)) !== null) {
    const parts = match[1].split("|");
    const slug = parts[0].trim();
    if (!slugs.includes(slug)) slugs.push(slug);
  }

  // Nur existierende Slugs als out_links speichern
  const existing = await db
    .select({ slug: wikiPages.slug })
    .from(wikiPages)
    .where(
      and(
        eq(wikiPages.workspace_id, workspaceId),
        sql`${wikiPages.slug} = ANY(${slugs}::text[])`,
      ),
    );

  const existingSlugs = existing.map((r) => r.slug);

  return { out_links: existingSlugs, content };
}

export async function updateIncomingLinks(
  workspaceId: string,
  slug: string,
  outLinks: string[],
) {
  // Für jede verlinkte Seite: in_links aktualisieren
  for (const targetSlug of outLinks) {
    const targetPage = await getPage(workspaceId, targetSlug);
    if (targetPage) {
      const currentInLinks: string[] = Array.isArray(targetPage.in_links)
        ? targetPage.in_links
        : [];
      if (!currentInLinks.includes(slug)) {
        await db
          .update(wikiPages)
          .set({
            in_links: [...currentInLinks, slug],
            updated_at: new Date(),
          })
          .where(
            and(
              eq(wikiPages.workspace_id, workspaceId),
              eq(wikiPages.slug, targetSlug),
            ),
          );
      }
    }
  }
}

// --- Wiki Stats ---

export async function getStats(workspaceId: string) {
  const [countResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(wikiPages)
    .where(eq(wikiPages.workspace_id, workspaceId));

  const typeResult = await db
    .select({ type: wikiPages.page_type, count: sql<number>`count(*)` })
    .from(wikiPages)
    .where(eq(wikiPages.workspace_id, workspaceId))
    .groupBy(wikiPages.page_type);

  const recent = await db
    .select()
    .from(wikiPages)
    .where(eq(wikiPages.workspace_id, workspaceId))
    .orderBy(desc(wikiPages.updated_at))
    .limit(5);

  const pagesByType: Record<string, number> = {};
  for (const r of typeResult) {
    pagesByType[r.type] = Number(r.count);
  }

  return {
    total_pages: Number(countResult?.count || 0),
    pages_by_type: pagesByType,
    total_links: 0, // TODO: berechnen
    recent_updates: recent,
  };
}

// --- WeKnora Import ---

export interface WeKnoraPage {
  id?: string;
  knowledge_base_id?: string;
  slug: string;
  title: string;
  summary?: string;
  content?: string;
  page_type?: string;
  status?: string;
  out_links?: string[];
  in_links?: string[];
  aliases?: string[];
  source_refs?: string[];
  page_metadata?: Record<string, any>;
  version?: number;
  created_at?: string;
  updated_at?: string;
}

const PAGE_TYPE_MAP: Record<string, string> = {
  entity: "entity",
  concept: "concept",
  article: "article",
  index: "index",
  log: "log",
  synthesis: "synthesis",
  comparison: "comparison",
  youtube_transcript: "youtube_transcript",
};

function mapPageType(type: string | undefined): string {
  if (!type) return "article";
  const lower = type.toLowerCase();
  return PAGE_TYPE_MAP[lower] || "article";
}

export async function importWeKnoraPages(
  workspaceId: string,
  pages: WeKnoraPage[],
  createdBy: number,
): Promise<{
  imported: number;
  skipped: number;
  errors: string[];
  pages: any[];
}> {
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];
  const importedPages: any[] = [];

  // Bestehende Slugs abrufen
  const existing = await listPages(workspaceId, { page_size: 500 });
  const existingSlugs = new Set(existing.pages.map((p) => p.slug));

  for (const wp of pages) {
    try {
      // Slug generieren – falls schon vorhanden, counter anhängen
      let slug = wp.slug?.trim();
      if (!slug) {
        slug = wp.title
          .toLowerCase()
          .replace(/[^a-z0-9äöüß]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 200);
      }
      if (!slug) {
        errors.push(`Page "${wp.title}" has no valid slug – skipped`);
        skipped++;
        continue;
      }

      // Prüfen ob bereits importiert
      if (existingSlugs.has(slug)) {
        // Slug mit Suffix
        let counter = 1;
        while (existingSlugs.has(`${slug}-${counter}`)) counter++;
        slug = `${slug}-${counter}`;
      }

      existingSlugs.add(slug);

      const page = await createPage({
        workspace_id: workspaceId,
        slug,
        title: wp.title || slug,
        content: wp.content || "",
        summary: wp.summary || "",
        page_type: mapPageType(wp.page_type),
        source_document_id: null,
        created_by: createdBy,
      });

      // Aliases, source_refs, page_metadata setzen
      if (
        (wp.aliases && wp.aliases.length > 0) ||
        (wp.source_refs && wp.source_refs.length > 0) ||
        (wp.page_metadata && Object.keys(wp.page_metadata).length > 0)
      ) {
        await db
          .update(wikiPages)
          .set({
            aliases: wp.aliases || [],
            source_refs: wp.source_refs || [],
            page_metadata: wp.page_metadata || {},
            updated_at: new Date(),
          })
          .where(
            and(
              eq(wikiPages.workspace_id, workspaceId),
              eq(wikiPages.slug, slug),
            ),
          );
      }

      // out_links aus Content extrahieren
      const { out_links } = await resolveLinks(workspaceId, page.content);
      const combinedLinks = [
        ...new Set([...out_links, ...(wp.out_links || [])]),
      ];

      if (combinedLinks.length > 0) {
        await updatePage(workspaceId, slug, { out_links: combinedLinks });
        await updateIncomingLinks(workspaceId, slug, combinedLinks);
      }

      importedPages.push({ ...page, slug });
      imported++;
    } catch (e: any) {
      errors.push(`Error importing "${wp.title || wp.slug}": ${e.message}`);
      skipped++;
    }
  }

  return { imported, skipped, errors, pages: importedPages };
}

// --- Wiki Generation via LLM ---

export async function generateWikiPage(
  workspaceId: string,
  documentId: string,
  existingSlugs: string[],
): Promise<Array<{
  slug: string;
  title: string;
  summary: string;
  content: string;
  page_type: string;
}> | null> {
  const t0 = Date.now();
  console.log(`[wiki] ========== generateWikiPage START ==========`);
  console.log(`[wiki] Document ID: ${documentId}`);
  console.log(`[wiki] Workspace ID: ${workspaceId}`);
  console.log(`[wiki] Existing slugs: ${existingSlugs.length}`);

  // Dokument laden
  const [doc] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);

  if (!doc || !doc.content) {
    console.log(`[wiki] ❌ Dokument nicht gefunden oder leer (${documentId})`);
    return null;
  }
  console.log(
    `[wiki] Dokument geladen: "${doc.title}" (${doc.content.length} Zeichen)`,
  );

  // Aktiven Chat-Provider laden
  const providers = await db
    .select()
    .from(modelProviders)
    .where(
      and(
        eq(modelProviders.is_active, true),
        eq(modelProviders.provider_type, "chat"),
      ),
    )
    .limit(1);

  let provider = providers[0];
  if (!provider) {
    const both = await db
      .select()
      .from(modelProviders)
      .where(
        and(
          eq(modelProviders.is_active, true),
          eq(modelProviders.provider_type, "both"),
        ),
      )
      .limit(1);
    provider = both[0];
  }

  if (!provider) {
    console.warn(
      "[wiki] ❌ Kein Chat-Provider für Wiki-Generierung konfiguriert",
    );
    return null;
  }

  console.log(
    `[wiki] LLM-Provider: ${provider.provider_name || provider.provider_type} (${provider.default_model})`,
  );
  console.log(`[wiki] API-Base: ${provider.api_base_url}`);

  // Wiki-Seiten als Kontext für Verlinkungen (nur aus diesem Dokument)
  const existingPages =
    existingSlugs.length > 0
      ? await db
          .select({ slug: wikiPages.slug, title: wikiPages.title })
          .from(wikiPages)
          .where(
            and(
              eq(wikiPages.workspace_id, workspaceId),
              eq(wikiPages.source_document_id, documentId),
              inArray(wikiPages.slug, existingSlugs),
            ),
          )
      : [];

  const pagesContext = existingPages
    .map((p) => `  - [[${p.slug}|${p.title}]]`)
    .join("\n");

  // Ungefähre Videolänge aus dem Titel/Inhalt schätzen
  // Fallback: 1000 Zeichen ≈ 10 Minuten Transkript
  const estimatedHours = Math.max(0.1, doc.content.length / 60000);

  const systemPrompt = `Du bist ein Wiki-Autor. Erstelle aus dem folgenden YouTube-Transkript **zwei** separate Wiki-Artikel auf Deutsch.

## WICHTIGE PRIORISIERUNG
Die YouTube-Metadaten (Titel, Kanal, Beschreibung) haben die HÖCHSTE Priorität für:
- Korrekte Schreibweise von Namen, Begriffen und Gesprächspartnern
- Kontext und Einordnung des Gesprächs
Diese Metadaten stehen ganz oben im Quelldokument und sind massgeblich.

## ARTIKEL 1 – Vollständiger Inhalt (Tag: VOLLSTAENDIG)
- Erfasst das GESAMTE Gespräch mit ALLEN Argumenten, Thesen, Details und Inhalten
- Vollständig, keine Kürzung, kein Weglassen von Argumenten
- Geschätzte Videolänge: ~${estimatedHours.toFixed(1)}h → angemessene Länge wählen
- Struktur mit ## Überschriften, die den Gesprächsverlauf abbilden

## ARTIKEL 2 – Zusammenfassung (Tag: ZUSAMMENFASSUNG)
- Konzentriert sich auf die 5-10 wichtigsten Thesen und Kernaussagen
- Maximal 1000-1500 Wörter, unabhängig von der Videolänge
- Struktur: ## Wichtigste Thesen als Bullet-Points mit kurzer Erklärung

## FORMAT (genau einhalten – jede Abweichung macht den Artikel unbrauchbar)

=== ARTIKEL 1: VOLLSTAENDIG ===
SUMMARY: {Ein Satz, 15-40 Wörter}
# {Titel des vollständigen Artikels}
{Inhalt als Markdown}

=== ARTIKEL 2: ZUSAMMENFASSUNG ===
SUMMARY: {Ein Satz, 15-40 Wörter}
# {Titel der Zusammenfassung}
{Inhalt als Markdown}

## REGELN FÜR BEIDE ARTIKEL
- Sprache: Deutsch
- Verlinke zu existierenden Seiten mit [[slug|Titel]]
- Maximal 6000 Tokens pro Artikel
- KEINE einleitenden Erklärungen oder Meta-Kommentare – nur die beiden Artikel im angegebenen Format

VORHANDENE SEITEN (für Verlinkungen):
${pagesContext || "Keine vorhanden."}

## QUELLDOKUMENT
YouTube-Metadaten + vollständiges Transkript:
${doc.content}`;

  try {
    console.log(
      `[wiki] Sende Prompt an LLM (${provider.default_model}, max_tokens=4096, timeout=60s)...`,
    );
    const llmT0 = Date.now();
    const response = await fetch(`${provider.api_base_url}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.api_key_encrypted}`,
      },
      body: JSON.stringify({
        model: provider.default_model,
        messages: [{ role: "user", content: systemPrompt }],
        max_tokens: 8192,
      }),
      signal: AbortSignal.timeout(60000),
    });

    const llmElapsed = Date.now() - llmT0;
    console.log(
      `[wiki] LLM antwortete nach ${llmElapsed}ms (Status: ${response.status})`,
    );

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      console.warn(
        `[wiki] ❌ LLM error: ${response.status} – ${errBody.slice(0, 200)}`,
      );
      return null;
    }

    const data = await response.json();
    const fullText = data?.choices?.[0]?.message?.content || "";
    console.log(`[wiki] LLM-Antwort: ${fullText.length} Zeichen`);
    // Ersten 500 Zeichen für Debugging loggen
    console.log(
      `[wiki] LLM-Antwort-Preview: ${fullText.slice(0, 500).replace(/\n/g, "\\n")}`,
    );

    if (!fullText) {
      console.warn(`[wiki] ❌ Leere LLM-Antwort`);
      return null;
    }

    // Zwei Artikel parsen (getrennt durch === ARTIKEL 2 oder === ZUSAMMENFASSUNG)
    // Akzeptiere verschiedene Schreibweisen:
    // === ARTIKEL 2 ===, === ARTIKEL 2: ZUSAMMENFASSUNG ===, === ZUSAMMENFASSUNG ===
    const articleSplitter =
      /===?\s*(?:ARTIKEL\s*2|ZUSAMMENFASSUNG)\s*:?\s*(?:ZUSAMMENFASSUNG)?\s*===?/i;
    const parts = fullText.split(articleSplitter);
    const rawArticle1 = parts[0] || "";
    const rawArticle2 = parts[1] || "";

    console.log(`[wiki] Artikel 1 Rohdaten: ${rawArticle1.length} Zeichen`);
    console.log(`[wiki] Artikel 2 Rohdaten: ${rawArticle2.length} Zeichen`);

    function parseArticle(
      raw: string,
      fallbackTitle: string,
      index: number,
    ): { summary: string; title: string; content: string } | null {
      const summaryMatch = raw.match(/SUMMARY:\s*(.+)/im);
      const summary = summaryMatch ? summaryMatch[1].trim() : "";

      // SUMMARY-Zeile aus Content entfernen
      let content = raw.replace(/SUMMARY:\s*.+(\r?\n|$)/i, "").trim();

      // Marker entfernen (=== ARTIKEL 1: VOLLSTAENDIG ===, etc.)
      content = content
        .replace(
          /===?\s*ARTIKEL\s*\d\s*:?\s*(VOLLSTAENDIG|ZUSAMMENFASSUNG)?\s*===?/gi,
          "",
        )
        .replace(/===?\s*(VOLLSTAENDIG|ZUSAMMENFASSUNG)\s*===?/gi, "")
        .trim();

      if (!content) {
        console.warn(`[wiki] Artikel ${index}: kein Inhalt gefunden`);
        return null;
      }

      const titleMatch = content.match(/^#\s+(.+)/m);
      const title = titleMatch
        ? titleMatch[1].trim()
        : `${fallbackTitle} (Teil ${index})`;

      console.log(
        `[wiki] Artikel ${index} geparst: "${title}" (${content.length} Zeichen, summary=${summary.slice(0, 60)})`,
      );
      return { summary, title, content };
    }

    const results: Array<{
      slug: string;
      title: string;
      summary: string;
      content: string;
      page_type: string;
    }> = [];

    const article1 = parseArticle(rawArticle1, doc.title, 1);
    const article2 = parseArticle(rawArticle2, doc.title, 2);

    // Hilfsfunktion: Slug aus Titel mit Prefix, vermeidet Doppelung
    function makeSlug(title: string, prefix: string): string {
      let t = title.toLowerCase().trim();
      // Prefix aus dem Titel entfernen falls vorhanden
      t = t.replace(new RegExp(`^${prefix}[\\s:-]+`, "i"), "");
      t = t.replace(/^vollstaendig[\s:-]+/i, "");
      t = t.replace(/^zusammenfassung[\s:-]+/i, "");
      return (
        prefix +
        "-" +
        t
          .replace(/[^a-z0-9äöüß\s-]/g, "")
          .replace(/\s+/g, "-")
          .replace(/-+/g, "-")
          .slice(0, 80)
      );
    }

    if (article1) {
      const slug = makeSlug(article1.title, "vollstaendig");

      // Cross-Link zwischen den Artikeln einfügen
      let content = article1.content;
      if (article2?.title) {
        const summarySlug = makeSlug(article2.title, "zusammenfassung");
        if (!content.includes(`[[${summarySlug}]]`)) {
          content += `\n\n---\n📄 **Zusammenfassung**: [[${summarySlug}|Zusammenfassung dieses Artikels]]`;
        }
      }

      console.log(
        `[wiki] ✅ Artikel 1 (vollstaendig): "${article1.title}" (${content.length} Zeichen)`,
      );
      results.push({
        slug,
        title: article1.title,
        summary: article1.summary,
        content,
        page_type: "vollstaendig",
      });
    }

    if (article2) {
      const slug = makeSlug(article2.title, "zusammenfassung");

      // Cross-Link zum vollständigen Artikel
      let content = article2.content;
      if (results.length > 0) {
        const fullSlug = results[0].slug;
        if (!content.includes(`[[${fullSlug}]]`)) {
          content = `📄 **Vollständiger Artikel**: [[${fullSlug}|Vollständiger Inhalt]]\n\n${content}`;
        }
      }

      console.log(
        `[wiki] ✅ Artikel 2 (zusammenfassung): "${article2.title}" (${content.length} Zeichen)`,
      );
      results.push({
        slug,
        title: article2.title,
        summary: article2.summary,
        content,
        page_type: "zusammenfassung",
      });
    }

    console.log(
      `[wiki] ========== generateWikiPage ENDE (${Date.now() - t0}ms, ${results.length} Artikel) ==========`,
    );
    return results.length > 0 ? results : null;
  } catch (e: any) {
    console.error(`[wiki] ❌ Generation error:`, e.message);
    console.log(
      `[wiki] ========== generateWikiPage FEHLER (${Date.now() - t0}ms) ==========`,
    );
    return null;
  }
}
