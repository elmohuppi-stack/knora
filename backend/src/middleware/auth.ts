import { createMiddleware } from "hono/factory";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { db } from "../db/index.ts";
import { users } from "../db/schema.ts";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@knora.app";

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: "admin" | "editor" | "viewer";
}

declare module "hono" {
  interface ContextVariableMap {
    user: AuthUser;
  }
}

export const authMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const token = authHeader.slice(7);
  let payload: AuthUser & { exp: number };
  try {
    payload = jwt.verify(token, JWT_SECRET) as AuthUser & { exp: number };
  } catch {
    return c.json({ error: "Invalid or expired token" }, 401);
  }

  // Die Rolle im Token ist nur ein Snapshot vom Login (7 Tage gültig). Für die
  // Autorisierung zählt der aktuelle DB-Stand, sonst wirkt eine Rollenänderung
  // erst nach erneutem Login. Der .env-Admin ist immer Admin, unabhängig davon,
  // was in der DB steht.
  const [dbUser] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
    })
    .from(users)
    .where(eq(users.id, payload.id))
    .limit(1);

  if (!dbUser) {
    return c.json({ error: "User no longer exists" }, 401);
  }

  c.set("user", {
    id: dbUser.id,
    email: dbUser.email,
    name: dbUser.name,
    role: (dbUser.email === ADMIN_EMAIL
      ? "admin"
      : dbUser.role) as AuthUser["role"],
  });
  await next();
});

export function requireRole(...roles: string[]) {
  return createMiddleware(async (c, next) => {
    const user = c.get("user");
    if (!user || !roles.includes(user.role)) {
      return c.json({ error: "Forbidden" }, 403);
    }
    await next();
  });
}
