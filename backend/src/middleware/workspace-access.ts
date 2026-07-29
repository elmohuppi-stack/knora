import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.ts";
import { workspaces, workspaceMembers, documents } from "../db/schema.ts";
import type { AuthUser } from "./auth.ts";

/**
 * Zwei-Ebenen-Rechtemodell:
 *
 *   users.role (global)          – was darf jemand systemweit
 *     admin   → sieht und bearbeitet ALLE Workspaces, dazu User-Verwaltung
 *               und Model-Provider
 *     editor  → darf Workspaces anlegen und in den eigenen alles
 *     viewer  → darf keine Workspaces anlegen und nirgends schreiben
 *
 *   workspace_members.role       – was darf jemand in DIESEM Workspace
 *     owner / editor → schreiben, viewer → lesen
 *
 * Schreiben setzt beides voraus: globale Rolle != viewer UND Workspace-Rolle
 * owner|editor. Der Ersteller (workspaces.created_by) gilt immer als owner,
 * auch ohne Mitgliedschaftszeile (Altbestand vor der Member-Einführung).
 */
export type AccessLevel = "read" | "write";
export type WorkspaceRole = "owner" | "editor" | "viewer";

/** "admin" ist der Altwert aus der Zeit vor der owner-Rolle. */
export function normalizeRole(role: string): WorkspaceRole {
  if (role === "owner" || role === "admin") return "owner";
  if (role === "editor") return "editor";
  return "viewer";
}

function forbidden(message: string): HTTPException {
  return new HTTPException(403, {
    res: Response.json({ error: message }, { status: 403 }),
  });
}

function notFound(): HTTPException {
  return new HTTPException(404, {
    res: Response.json({ error: "Workspace not found" }, { status: 404 }),
  });
}

/**
 * Effektive Workspace-Rolle des Users – oder null, wenn er keinerlei Zugriff
 * hat bzw. der Workspace nicht existiert.
 */
export async function getWorkspaceRole(
  user: AuthUser,
  workspaceId: string,
): Promise<WorkspaceRole | null> {
  const [ws] = await db
    .select({ created_by: workspaces.created_by })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  if (!ws) return null;

  if (user.role === "admin") return "owner";
  if (ws.created_by === user.id) return "owner";

  const [member] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspace_id, workspaceId),
        eq(workspaceMembers.user_id, user.id),
      ),
    )
    .limit(1);
  if (!member) return null;
  return normalizeRole(member.role);
}

/** Darf der User in diesem Workspace schreiben? */
export function canWrite(user: AuthUser, role: WorkspaceRole | null): boolean {
  if (!role) return false;
  if (user.role === "viewer") return false;
  return role === "owner" || role === "editor";
}

/**
 * Wirft 404 (kein Zugriff / existiert nicht – bewusst nicht unterscheidbar,
 * damit fremde Workspace-IDs nicht durchprobiert werden können) bzw. 403
 * (lesen erlaubt, schreiben nicht).
 */
export async function assertWorkspaceAccess(
  user: AuthUser,
  workspaceId: string,
  level: AccessLevel,
): Promise<WorkspaceRole> {
  const role = await getWorkspaceRole(user, workspaceId);
  if (!role) throw notFound();
  if (level === "write" && !canWrite(user, role)) {
    throw forbidden("Keine Schreibrechte in diesem Workspace");
  }
  return role;
}

/** Wie assertWorkspaceAccess, aber ausgehend von einer Dokument-ID. */
export async function assertDocumentAccess(
  user: AuthUser,
  documentId: string,
  level: AccessLevel,
): Promise<{ workspaceId: string; role: WorkspaceRole }> {
  const [doc] = await db
    .select({ workspace_id: documents.workspace_id })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);
  if (!doc) {
    throw new HTTPException(404, {
      res: Response.json({ error: "Document not found" }, { status: 404 }),
    });
  }
  const role = await assertWorkspaceAccess(user, doc.workspace_id, level);
  return { workspaceId: doc.workspace_id, role };
}

/** Nur globale Admins und Editoren dürfen überhaupt Workspaces anlegen. */
export function assertCanCreateWorkspace(user: AuthUser): void {
  if (user.role === "viewer") {
    throw forbidden("Viewer dürfen keine Workspaces anlegen");
  }
}

/**
 * Middleware für Router, deren Routen alle mit /:workspaceId beginnen
 * (wiki, topics). Das Zugriffslevel ergibt sich aus der HTTP-Methode:
 * GET/HEAD lesen, alles andere schreiben.
 */
export function workspaceParamAccess(paramName = "workspaceId") {
  return createMiddleware(async (c, next) => {
    const user = c.get("user");
    // Fallback über die UUID im Pfad, falls der Router-Parameter in der
    // Middleware nicht aufgelöst wird – lieber prüfen als durchwinken.
    const workspaceId =
      c.req.param(paramName) ??
      c.req.path.match(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
      )?.[0];
    if (!workspaceId) {
      return c.json({ error: `${paramName} is required` }, 400);
    }
    const level: AccessLevel =
      c.req.method === "GET" || c.req.method === "HEAD" ? "read" : "write";
    await assertWorkspaceAccess(user, workspaceId, level);
    await next();
  });
}
