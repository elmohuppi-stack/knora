import { db } from "./index.ts";
import { users } from "./schema.ts";
import bcrypt from "bcryptjs";

async function seed() {
  console.log("🌱 Seeding database...");

  const password_hash = await bcrypt.hash("admin123", 12);

  const [admin] = await db
    .insert(users)
    .values({
      email: "admin@knora.app",
      password_hash,
      name: "Admin",
      role: "admin",
    })
    .onConflictDoNothing()
    .returning();

  if (admin) {
    console.log(`✅ Created admin user: ${admin.email} (password: admin123)`);
  } else {
    console.log("ℹ️  Admin user already exists");
  }

  console.log("🌱 Seed complete!");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed!", err);
  process.exit(1);
});
