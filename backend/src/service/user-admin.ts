import { db } from "../db/index.ts";
import { users } from "../db/schema.ts";
import { eq, desc } from "drizzle-orm";

export async function listUsers() {
  return await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      created_at: users.created_at,
      updated_at: users.updated_at,
    })
    .from(users)
    .orderBy(desc(users.created_at));
}

export async function updateUserRole(userId: number, role: string) {
  const [user] = await db
    .update(users)
    .set({ role, updated_at: new Date() })
    .where(eq(users.id, userId))
    .returning({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      created_at: users.created_at,
      updated_at: users.updated_at,
    });
  return user || null;
}

export async function deleteUser(userId: number) {
  await db.delete(users).where(eq(users.id, userId));
}
