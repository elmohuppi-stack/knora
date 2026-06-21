import { db } from "../db/index.ts";
import { workspaces, workspaceMembers } from "../db/schema.ts";
import { eq, and, desc } from "drizzle-orm";

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

  return unique;
}

export async function getWorkspace(id: string) {
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, id))
    .limit(1);
  return workspace || null;
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
  data: { name?: string; description?: string; chunk_size?: number; chunk_overlap?: number },
) {
  const [workspace] = await db
    .update(workspaces)
    .set({
      ...data,
      updated_at: new Date(),
    })
    .where(eq(workspaces.id, id))
    .returning();
  return workspace || null;
}

export async function deleteWorkspace(id: string) {
  await db.delete(workspaces).where(eq(workspaces.id, id));
}

export async function listMembers(workspaceId: string) {
  const rows = await db
    .select()
    .from(workspaceMembers)
    .where(eq(workspaceMembers.workspace_id, workspaceId));
  return rows;
}

export async function addMember(workspaceId: string, userId: number, role: string = "viewer") {
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
