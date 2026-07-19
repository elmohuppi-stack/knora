import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { authMiddleware } from "../middleware/auth.ts";
import * as wikiService from "../service/wiki.ts";

const wikiRouter = new Hono();
wikiRouter.use("*", authMiddleware);

const createSchema = z.object({
  slug: z.string().min(1).max(255),
  title: z.string().min(1).max(512),
  content: z.string().optional(),
  summary: z.string().optional(),
  page_type: z.enum(["article", "entity", "concept"]).optional(),
  source_document_id: z.string().uuid().optional(),
});

const updateSchema = z.object({
  title: z.string().min(1).max(512).optional(),
  content: z.string().optional(),
  summary: z.string().optional(),
  page_type: z.enum(["article", "entity", "concept"]).optional(),
  status: z.enum(["published", "draft", "archived"]).optional(),
});

const WIKI_SORTS = [
  "updated_desc",
  "updated_asc",
  "title_asc",
  "title_desc",
  "published_desc",
  "published_asc",
  "connections_desc",
] as const;
type WikiSortT = (typeof WIKI_SORTS)[number];

// Wiki-Seiten eines Workspace auflisten (mit Filter/Sortierung, Ebene 2)
wikiRouter.get("/:workspaceId/pages", async (c) => {
  const workspaceId = c.req.param("workspaceId");
  const q = c.req.query();
  const parseDate = (v?: string) => {
    if (!v) return undefined;
    const d = new Date(v);
    return isNaN(d.getTime()) ? undefined : d;
  };

  const result = await wikiService.listPages(workspaceId, {
    page_type: q.page_type || undefined,
    query: q.query || undefined,
    source_document_id: q.source_document_id || undefined,
    channel: q.channel || undefined,
    dateFrom: parseDate(q.from),
    dateTo: parseDate(q.to),
    topicIds: q.topics ? q.topics.split(",").filter(Boolean) : undefined,
    references: q.references || undefined,
    sort: WIKI_SORTS.includes(q.sort as WikiSortT)
      ? (q.sort as WikiSortT)
      : undefined,
    page: parseInt(q.page || "1"),
    page_size: q.page_size ? parseInt(q.page_size) : undefined,
  });
  return c.json(result);
});

// Graph-Daten (Fokus-Subgraph oder Top-Konzepte-Wolke)
wikiRouter.get("/:workspaceId/graph", async (c) => {
  const workspaceId = c.req.param("workspaceId");
  const q = c.req.query();
  const graph = await wikiService.getGraph(workspaceId, {
    focus: q.focus || undefined,
    types: q.types ? q.types.split(",").filter(Boolean) : undefined,
    limit: q.limit ? parseInt(q.limit) : undefined,
  });
  return c.json(graph);
});

// Ebene 3: meistverlinkte Konzepte (Backlink-Einstiegspunkte)
wikiRouter.get("/:workspaceId/concepts/top", async (c) => {
  const workspaceId = c.req.param("workspaceId");
  const limit = parseInt(c.req.query("limit") || "20");
  const concepts = await wikiService.topConcepts(workspaceId, limit);
  return c.json({ concepts });
});

// Einzelne Wiki-Seite abrufen (per Slug)
wikiRouter.get("/:workspaceId/pages/:slug", async (c) => {
  const workspaceId = c.req.param("workspaceId");
  const slug = decodeURIComponent(c.req.param("slug"));
  const page = await wikiService.getPage(workspaceId, slug);
  if (!page) return c.json({ error: "Page not found" }, 404);
  return c.json({ page });
});

// Wiki-Seite erstellen
wikiRouter.post(
  "/:workspaceId/pages",
  zValidator("json", createSchema),
  async (c) => {
    const workspaceId = c.req.param("workspaceId");
    const user = c.get("user");
    const data = c.req.valid("json");

    // Prüfen ob Slug bereits existiert
    const existing = await wikiService.getPage(workspaceId, data.slug);
    if (existing) {
      return c.json({ error: "Slug already exists" }, 409);
    }

    const page = await wikiService.createPage({
      ...data,
      workspace_id: workspaceId,
      created_by: user.id,
    });

    // Links auflösen
    if (page.content) {
      const { out_links } = await wikiService.resolveLinks(
        workspaceId,
        page.content,
      );
      if (out_links.length > 0) {
        await wikiService.updatePage(workspaceId, page.slug, { out_links });
        await wikiService.updateIncomingLinks(
          workspaceId,
          page.slug,
          out_links,
        );
      }
    }

    return c.json({ page }, 201);
  },
);

// Wiki-Seite aktualisieren
wikiRouter.put(
  "/:workspaceId/pages/:slug",
  zValidator("json", updateSchema),
  async (c) => {
    const workspaceId = c.req.param("workspaceId");
    const slug = decodeURIComponent(c.req.param("slug"));
    const data = c.req.valid("json");
    const user = c.get("user");
    // Manueller Edit (Ebene 4): Snapshot + Lock setzen.
    const opts = { manual: true, editedBy: user?.id };

    const page = await wikiService.updatePage(workspaceId, slug, data, opts);
    if (!page) return c.json({ error: "Page not found" }, 404);

    // Bei Content-Änderung: Links neu auflösen (ebenfalls als manual, sonst
    // blockt der frisch gesetzte Lock das out_links-Update).
    if (data.content) {
      const { out_links } = await wikiService.resolveLinks(
        workspaceId,
        data.content,
      );
      if (out_links.length > 0) {
        await wikiService.updatePage(workspaceId, slug, { out_links }, opts);
        await wikiService.updateIncomingLinks(workspaceId, slug, out_links);
      }
    }

    return c.json({ page });
  },
);

// Ebene 4: Versionshistorie einer Seite
wikiRouter.get("/:workspaceId/pages/:slug/revisions", async (c) => {
  const workspaceId = c.req.param("workspaceId");
  const slug = decodeURIComponent(c.req.param("slug"));
  const revisions = await wikiService.listRevisions(workspaceId, slug);
  return c.json({ revisions });
});

// Ebene 4: frühere Fassung wiederherstellen
wikiRouter.post(
  "/:workspaceId/pages/:slug/revisions/:revId/restore",
  async (c) => {
    const workspaceId = c.req.param("workspaceId");
    const slug = decodeURIComponent(c.req.param("slug"));
    const revId = parseInt(c.req.param("revId"));
    const user = c.get("user");
    const page = await wikiService.restoreRevision(
      workspaceId,
      slug,
      revId,
      user?.id,
    );
    if (!page) return c.json({ error: "Revision not found" }, 404);
    return c.json({ page });
  },
);

// Wiki-Seite löschen
wikiRouter.delete("/:workspaceId/pages/:slug", async (c) => {
  const workspaceId = c.req.param("workspaceId");
  const slug = decodeURIComponent(c.req.param("slug"));
  await wikiService.deletePage(workspaceId, slug);
  return c.json({ success: true });
});

// Wiki-Seite aus Dokument generieren (neue Pipeline)
wikiRouter.post("/:workspaceId/generate/:documentId", async (c) => {
  const workspaceId = c.req.param("workspaceId");
  const documentId = c.req.param("documentId");

  try {
    const { generateWikiArticles } =
      await import("../service/wiki-generate.ts");
    const result = await generateWikiArticles(documentId, workspaceId);

    if (!result) {
      return c.json(
        {
          error:
            "Generation failed - no chat provider configured or document empty",
        },
        400,
      );
    }

    return c.json(
      {
        summary: result.summary,
        entities: result.entities,
        concepts: result.concepts,
      },
      201,
    );
  } catch (e: any) {
    console.error("[wiki] Generation error:", e.message);
    return c.json({ error: `Generation failed: ${e.message}` }, 500);
  }
});

// Wiki-Statistiken
wikiRouter.get("/:workspaceId/stats", async (c) => {
  const workspaceId = c.req.param("workspaceId");
  const stats = await wikiService.getStats(workspaceId);
  return c.json(stats);
});

// Strukturierte Index-Ansicht (Intro + getypte Paginierung)
wikiRouter.get("/:workspaceId/index", async (c) => {
  const workspaceId = c.req.param("workspaceId");
  const types = c.req.query("types")?.split(",") || [
    "summary",
    "entity",
    "concept",
  ];
  const limit = parseInt(c.req.query("limit") || "50");
  const cursor = c.req.query("cursor") || "";

  // Index-Seite (Intro) laden
  const indexPage = await wikiService.getPage(workspaceId, "index");

  // Pro Type die ersten Seiten laden
  const groups: Record<string, { total: number; pages: any[] }> = {};
  for (const type of types) {
    const result = await wikiService.listPages(workspaceId, {
      page_type: type,
      page_size: limit,
      page: 1,
    });
    groups[type] = { total: result.total, pages: result.pages };
  }

  return c.json({
    intro: indexPage?.summary || "",
    groups,
    total_pages: Object.values(groups).reduce((s, g) => s + g.total, 0),
  });
});

// Seiten nach Typ (paginierte Liste für Tab-Bar)
wikiRouter.get("/:workspaceId/pages-by-type", async (c) => {
  const workspaceId = c.req.param("workspaceId");
  const type = c.req.query("type") || "";
  const page = parseInt(c.req.query("page") || "1");
  const pageSize = parseInt(c.req.query("page_size") || "50");

  const result = await wikiService.listPages(workspaceId, {
    page_type: type || undefined,
    page,
    page_size: pageSize,
  });

  return c.json(result);
});

// WeKnora Import – mehrere Wiki-Seiten auf einmal importieren
const importSchema = z.object({
  pages: z.array(
    z.object({
      slug: z.string().optional(),
      title: z.string().min(1),
      summary: z.string().optional(),
      content: z.string().optional(),
      page_type: z.string().optional(),
      status: z.string().optional(),
      out_links: z.array(z.string()).optional(),
      in_links: z.array(z.string()).optional(),
      aliases: z.array(z.string()).optional(),
      source_refs: z.array(z.string()).optional(),
      page_metadata: z.record(z.any()).optional(),
      version: z.number().optional(),
      created_at: z.string().optional(),
      updated_at: z.string().optional(),
    }),
  ),
  overwrite: z.boolean().optional().default(false),
});

wikiRouter.post(
  "/:workspaceId/import",
  zValidator("json", importSchema),
  async (c) => {
    const workspaceId = c.req.param("workspaceId");
    const user = c.get("user");
    const { pages, overwrite } = c.req.valid("json");

    const result = await wikiService.importWeKnoraPages(
      workspaceId,
      pages,
      user.id,
    );

    return c.json({
      imported: result.imported,
      skipped: result.skipped,
      errors: result.errors.length > 0 ? result.errors : undefined,
      pages: result.pages,
    });
  },
);

// Slug-Vorschläge (für Auto-Complete im Editor)
wikiRouter.get("/:workspaceId/suggestions", async (c) => {
  const workspaceId = c.req.param("workspaceId");
  const query = c.req.query("q") || "";

  const result = await wikiService.listPages(workspaceId, {
    query,
    page_size: 20,
  });
  return c.json({
    suggestions: result.pages.map((p) => ({
      slug: p.slug,
      title: p.title,
      page_type: p.page_type,
    })),
  });
});

export { wikiRouter };
