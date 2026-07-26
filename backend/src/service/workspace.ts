import { db } from "../db/index.ts";
import {
  workspaces,
  workspaceMembers,
  documents,
  documentTopics,
  topics,
  chunks,
  wikiPages,
  wikiPageRevisions,
  chatSessions,
  chatMessages,
  activityLogs,
} from "../db/schema.ts";
import { eq, and, desc, like, or, sql, inArray } from "drizzle-orm";

/** Generiert einen URL-freundlichen Slug aus einem Namen */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9äöüß\s-]/g, "")
    .replace(/[\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

export async function listWorkspaces(userId: number) {
  const owned = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.created_by, userId))
    .orderBy(desc(workspaces.created_at));

  const memberRows = await db
    .select({
      workspace: workspaces,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspace_id, workspaces.id))
    .where(
      and(
        eq(workspaceMembers.user_id, userId),
        eq(workspaceMembers.role, "admin"),
      ),
    )
    .orderBy(desc(workspaces.created_at));

  const memberWorkspaces = memberRows.map((r) => r.workspace);
  const all = [...owned, ...memberWorkspaces];
  const seen = new Set<string>();
  const unique = all.filter((w) => {
    if (seen.has(w.id)) return false;
    seen.add(w.id);
    return true;
  });

  return unique.map((w) => ({ ...w, slug: slugify(w.name) }));
}

export async function getWorkspace(id: string) {
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, id))
    .limit(1);
  return workspace ? { ...workspace, slug: slugify(workspace.name) } : null;
}

/** Findet einen Workspace anhand des generierten Slugs (aus dem Namen) */
export async function getWorkspaceBySlug(slug: string) {
  const all = await db.select().from(workspaces);
  const match = all.find((w) => slugify(w.name) === slug);
  return match ? { ...match, slug: slugify(match.name) } : null;
}

export async function createWorkspace(data: {
  name: string;
  description?: string;
  created_by: number;
  chunk_size?: number;
  chunk_overlap?: number;
}) {
  const [workspace] = await db
    .insert(workspaces)
    .values({
      id: crypto.randomUUID(),
      name: data.name,
      description: data.description || null,
      created_by: data.created_by,
      chunk_size: data.chunk_size || 512,
      chunk_overlap: data.chunk_overlap || 50,
    })
    .returning();
  return workspace;
}

export async function updateWorkspace(
  id: string,
  data: {
    name?: string;
    description?: string;
    chunk_size?: number;
    chunk_overlap?: number;
    wiki_depth?: string;
  },
) {
  const { wiki_depth, ...rest } = data;
  const setClause: Record<string, any> = { ...rest, updated_at: new Date() };
  // wiki_depth in das bestehende wiki_config-JSONB mergen (übrige Keys erhalten).
  if (wiki_depth !== undefined) {
    setClause.wiki_config = sql`coalesce(${workspaces.wiki_config}, '{}'::jsonb) || ${JSON.stringify(
      { wiki_depth },
    )}::jsonb`;
  }
  const [workspace] = await db
    .update(workspaces)
    .set(setClause)
    .where(eq(workspaces.id, id))
    .returning();
  return workspace || null;
}

export async function deleteWorkspace(id: string) {
  // Die abhängigen Tabellen haben Foreign Keys auf workspaces.id OHNE
  // ON DELETE CASCADE. Ein reines DELETE auf workspaces schlägt daher mit
  // einer FK-Verletzung fehl (500). Deshalb hier alle Kinder in FK-sicherer
  // Reihenfolge in EINER Transaktion löschen (Kinder vor Eltern).
  await db.transaction(async (tx) => {
    // Sub-Selects für die indirekt (über documents/chat_sessions) verknüpften
    // Tabellen. Alle betroffenen Zeilen gehören zu genau diesem Workspace.
    const docIds = tx
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.workspace_id, id));
    const sessionIds = tx
      .select({ id: chatSessions.id })
      .from(chatSessions)
      .where(eq(chatSessions.workspace_id, id));

    await tx
      .delete(chatMessages)
      .where(inArray(chatMessages.session_id, sessionIds));
    await tx.delete(chatSessions).where(eq(chatSessions.workspace_id, id));

    await tx
      .delete(wikiPageRevisions)
      .where(eq(wikiPageRevisions.workspace_id, id));
    await tx.delete(wikiPages).where(eq(wikiPages.workspace_id, id));

    await tx
      .delete(documentTopics)
      .where(inArray(documentTopics.document_id, docIds));
    await tx.delete(chunks).where(eq(chunks.workspace_id, id));
    await tx.delete(topics).where(eq(topics.workspace_id, id));

    // activity_logs referenziert workspaces.id UND documents.id → vor documents
    // löschen und beide Bezüge abdecken (auch Logs mit nur document_id).
    await tx
      .delete(activityLogs)
      .where(
        or(
          eq(activityLogs.workspace_id, id),
          inArray(activityLogs.document_id, docIds),
        ),
      );
    await tx.delete(documents).where(eq(documents.workspace_id, id));

    await tx
      .delete(workspaceMembers)
      .where(eq(workspaceMembers.workspace_id, id));
    await tx.delete(workspaces).where(eq(workspaces.id, id));
  });
}

export async function listMembers(workspaceId: string) {
  const rows = await db
    .select()
    .from(workspaceMembers)
    .where(eq(workspaceMembers.workspace_id, workspaceId));
  return rows;
}

export async function addMember(
  workspaceId: string,
  userId: number,
  role: string = "viewer",
) {
  const [member] = await db
    .insert(workspaceMembers)
    .values({
      workspace_id: workspaceId,
      user_id: userId,
      role,
    })
    .returning();
  return member;
}

export async function removeMember(workspaceId: string, userId: number) {
  await db
    .delete(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspace_id, workspaceId),
        eq(workspaceMembers.user_id, userId),
      ),
    );
}
