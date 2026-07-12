import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { authMiddleware, requireRole } from "../middleware/auth.ts";
import * as userService from "../service/user-admin.ts";
import * as activityLogService from "../service/activity-log.ts";

const adminRouter = new Hono();
adminRouter.use("*", authMiddleware, requireRole("admin"));

const roleSchema = z.object({
  role: z.enum(["admin", "editor", "viewer"]),
});

// User-Liste (Admin only)
adminRouter.get("/users", async (c) => {
  const list = await userService.listUsers();
  return c.json({ users: list });
});

// User-Rolle ändern
adminRouter.put(
  "/users/:id/role",
  zValidator("json", roleSchema),
  async (c) => {
    const userId = parseInt(c.req.param("id"));
    const { role } = c.req.valid("json");
    const user = await userService.updateUserRole(userId, role);
    if (!user) return c.json({ error: "User not found" }, 404);
    return c.json({ user });
  },
);

// User löschen
adminRouter.delete("/users/:id", async (c) => {
  const userId = parseInt(c.req.param("id"));
  await userService.deleteUser(userId);
  return c.json({ success: true });
});

// Aktivitätslogs abrufen
adminRouter.get("/activity-logs", async (c) => {
  const action = c.req.query("action");
  const status = c.req.query("status");
  const workspace_id = c.req.query("workspace_id");
  const document_id = c.req.query("document_id");
  const limit = parseInt(c.req.query("limit") || "50");
  const offset = parseInt(c.req.query("offset") || "0");

  const result = await activityLogService.getLogs({
    action,
    status,
    workspace_id,
    document_id,
    limit,
    offset,
  });
  return c.json(result);
});

export { adminRouter };
