import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { authMiddleware } from "../middleware/auth.ts";
import * as workspaceService from "../service/workspace.ts";

const workspaceRouter = new Hono();
workspaceRouter.use("*", authMiddleware);

const createSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  chunk_size: z.number().min(128).max(4096).optional(),
  chunk_overlap: z.number().min(0).max(512).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  chunk_size: z.number().min(128).max(4096).optional(),
  chunk_overlap: z.number().min(0).max(512).optional(),
});

const memberSchema = z.object({
  user_id: z.number(),
  role: z.enum(["admin", "editor", "viewer"]).default("viewer"),
});

// Liste aller Workspaces für den aktuellen User
workspaceRouter.get("/", async (c) => {
  const user = c.get("user");
  const list = await workspaceService.listWorkspaces(user.id);
  return c.json({ workspaces: list });
});

// Workspace per Slug finden
workspaceRouter.get("/by-slug/:slug", async (c) => {
  const slug = c.req.param("slug");
  const ws = await workspaceService.getWorkspaceBySlug(slug);
  if (!ws) return c.json({ error: "Workspace not found" }, 404);
  return c.json({ workspace: ws });
});

// Einzelnen Workspace abrufen
workspaceRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const ws = await workspaceService.getWorkspace(id);
  if (!ws) return c.json({ error: "Workspace not found" }, 404);
  return c.json({ workspace: ws });
});

// Workspace erstellen
workspaceRouter.post("/", zValidator("json", createSchema), async (c) => {
  const user = c.get("user");
  const data = c.req.valid("json");
  const ws = await workspaceService.createWorkspace({
    ...data,
    created_by: user.id,
  });
  return c.json({ workspace: ws }, 201);
});

// Workspace aktualisieren
workspaceRouter.put("/:id", zValidator("json", updateSchema), async (c) => {
  const id = c.req.param("id");
  const data = c.req.valid("json");
  const ws = await workspaceService.updateWorkspace(id, data);
  if (!ws) return c.json({ error: "Workspace not found" }, 404);
  return c.json({ workspace: ws });
});

// Workspace löschen
workspaceRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  await workspaceService.deleteWorkspace(id);
  return c.json({ success: true });
});

// Mitglieder auflisten
workspaceRouter.get("/:id/members", async (c) => {
  const id = c.req.param("id");
  const members = await workspaceService.listMembers(id);
  return c.json({ members });
});

// Mitglied hinzufügen
workspaceRouter.post(
  "/:id/members",
  zValidator("json", memberSchema),
  async (c) => {
    const id = c.req.param("id");
    const { user_id, role } = c.req.valid("json");
    const member = await workspaceService.addMember(id, user_id, role);
    return c.json({ member }, 201);
  },
);

// Mitglied entfernen
workspaceRouter.delete("/:id/members/:userId", async (c) => {
  const id = c.req.param("id");
  const userId = parseInt(c.req.param("userId"));
  await workspaceService.removeMember(id, userId);
  return c.json({ success: true });
});

export { workspaceRouter };
