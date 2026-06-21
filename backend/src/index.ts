import { Hono } from "hono";
import { cors } from "hono/cors";
import { authRouter } from "./router/auth.ts";
import { workspaceRouter } from "./router/workspace.ts";
import { adminRouter } from "./router/admin.ts";
import { modelRouter } from "./router/model.ts";

const app = new Hono();

app.use(
  "/*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    exposeHeaders: ["Content-Length"],
    maxAge: 86400,
  }),
);

// Health
app.get("/health", (c) => c.json({ status: "ok" }));

// Auth Routes
app.route("/api/v1/auth", authRouter);

// Workspace Routes
app.route("/api/v1/workspaces", workspaceRouter);

// Admin Routes (User-Management)
app.route("/api/v1/admin", adminRouter);

// Model Provider Routes
app.route("/api/v1/models", modelRouter);

// Future routes will be added here:
// app.route("/api/v1/users", userRouter);
// app.route("/api/v1/workspaces", workspaceRouter);
// app.route("/api/v1/documents", documentRouter);
// app.route("/api/v1/wiki", wikiRouter);
// app.route("/api/v1/chat", chatRouter);
// app.route("/api/v1/models", modelRouter);
// app.route("/api/v1/search", searchRouter);

const port = parseInt(process.env.PORT || "3000");

console.log(`🚀 Wiki-Chat API running on port ${port}`);

Bun.serve({
  port,
  fetch: app.fetch,
});
