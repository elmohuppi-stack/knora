import { db } from "../db/index.ts";
import { wikiPages, documents, modelProviders } from "../db/schema.ts";
import { eq, and, like, or, desc, sql } from "drizzle-orm";

// --- CRUD ---

export async function listPages(
  workspaceId: string,
  options?: { page_type?: string; query?: string; page?: number; page_size?: number },
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
      and(eq(wikiPages.workspace_id, workspaceId), sql`${slug} = ANY(in_links)`),
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

// --- Wiki Generation via LLM ---

export async function generateWikiPage(
  workspaceId: string,
  documentId: string,
  existingSlugs: string[],
): Promise<{ slug: string; title: string; summary: string; content: string } | null> {
  // Dokument laden
  const [doc] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);

  if (!doc || !doc.content) return null;

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
    console.warn("[wiki] No chat provider configured for wiki generation");
    return null;
  }

  // Wiki-Seiten als Kontext für Verlinkungen
  const existingPages = existingSlugs.length > 0
    ? await db
        .select({ slug: wikiPages.slug, title: wikiPages.title })
        .from(wikiPages)
        .where(
          and(
            eq(wikiPages.workspace_id, workspaceId),
            sql`${wikiPages.slug} = ANY(${existingSlugs}::text[])`,
          ),
        )
    : [];

  const pagesContext = existingPages
    .map((p) => `  - [[${p.slug}|${p.title}]]`)
    .join("\n");

  const systemPrompt = `Du bist ein Wiki-Autor. Erstelle einen gut strukturierten Wiki-Artikel aus dem folgenden Dokument.

FORMAT:
SUMMARY: {Ein Satz, 15-40 Wörter}
{Inhalt als Markdown}

REGELN:
1. Erste Zeile: SUMMARY: ...
2. Danach vollständiger Wiki-Artikel mit ##-Überschriften
3. Verlinke zu existierenden Seiten mit [[slug|Titel]]
4. Maximal 4000 Wörter
5. Sprache: Deutsch
6. Am Ende: ## Zusammenfassung mit Bullet-Points

VORHANDENE SEITEN (für Verlinkungen):
${pagesContext || "Keine vorhanden."}

QUELLDOKUMENT:
${doc.content.slice(0, 15000)}`;

  try {
    const response = await fetch(`${provider.api_base_url}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.api_key_encrypted}`,
      },
      body: JSON.stringify({
        model: provider.default_model,
        messages: [{ role: "user", content: systemPrompt }],
        max_tokens: 4096,
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      console.warn(`[wiki] LLM error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const fullText = data?.choices?.[0]?.message?.content || "";

    // SUMMARY parsen
    const summaryMatch = fullText.match(/^SUMMARY:\s*(.+)/m);
    const summary = summaryMatch ? summaryMatch[1].trim() : "";
    const content = fullText.replace(/^SUMMARY:\s*.+(\r?\n|$)/, "").trim();

    // Slug aus Titel generieren
    const titleMatch = content.match(/^#\s+(.+)/m);
    const title = titleMatch ? titleMatch[1].trim() : doc.title;
    const slug = "wiki/" + title
      .toLowerCase()
      .replace(/[^a-z0-9äöüß\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 80);

    return { slug, title, summary, content };
  } catch (e: any) {
    console.error(`[wiki] Generation error:`, e.message);
    return null;
  }
}
