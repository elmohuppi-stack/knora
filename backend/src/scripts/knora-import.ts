#!/usr/bin/env bun
/**
 * WeKnora → Knora Import Script
 *
 * Importiert exportierte Wiki-Seiten aus WeKnora (JSON) in Knora.
 *
 * Verwendung:
 *   bun run src/scripts/knora-import.ts <workspace-id> <json-datei>
 *
 * JSON-Format (WeKnora-Export):
 *   [
 *     {
 *       "slug": "entity/weknora-architecture",
 *       "title": "WeKnora Architecture",
 *       "summary": "...",
 *       "content": "# Markdown...",
 *       "page_type": "entity",
 *       "status": "published",
 *       "out_links": ["go", "gin"],
 *       "in_links": ["weknora-overview"],
 *       "aliases": ["WeKnora Arch"],
 *       "source_refs": ["kb_id|doc.pdf"],
 *       "page_metadata": { "tags": ["architecture"] }
 *     }
 *   ]
 */

import { db } from "../db/index.ts";
import { users } from "../db/schema.ts";
import { eq } from "drizzle-orm";
import { importWeKnoraPages, type WeKnoraPage } from "../service/wiki.ts";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log(`
🔧 WeKnora → Knora Import Script

Usage:
  bun run src/scripts/knora-import.ts <workspace-id> <json-file> [--dry-run]

Options:
  --dry-run    Nur analysieren, nicht importieren

Examples:
  bun run src/scripts/knora-import.ts abc-123 ./export.json
  bun run src/scripts/knora-import.ts abc-123 ./export.json --dry-run
`);
    process.exit(1);
  }

  const workspaceId = args[0];
  const jsonFilePath = path.resolve(args[1]);
  const dryRun = args.includes("--dry-run");

  // JSON-Datei lesen
  if (!fs.existsSync(jsonFilePath)) {
    console.error(`❌ Datei nicht gefunden: ${jsonFilePath}`);
    process.exit(1);
  }

  console.log(`📖 Lese: ${jsonFilePath}`);
  const raw = fs.readFileSync(jsonFilePath, "utf-8");
  let pages: WeKnoraPage[];

  try {
    const parsed = JSON.parse(raw);
    pages = Array.isArray(parsed) ? parsed : parsed.pages || [parsed];
  } catch (e: any) {
    console.error(`❌ JSON-Parse-Fehler: ${e.message}`);
    process.exit(1);
  }

  if (pages.length === 0) {
    console.log("⚠️ Keine Seiten zum Importieren gefunden.");
    process.exit(0);
  }

  console.log(`📊 Gefundene Seiten: ${pages.length}`);
  console.log("");

  // Vorschau
  const typeCounts: Record<string, number> = {};
  for (const p of pages) {
    const t = p.page_type || "article";
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  }
  console.log("📋 Seiten-Typen:");
  for (const [type, count] of Object.entries(typeCounts)) {
    console.log(`   ${type}: ${count}`);
  }
  console.log("");

  if (dryRun) {
    console.log("🏁 Dry-Run – keine Änderungen vorgenommen.");
    process.exit(0);
  }

  // Admin-User ermitteln (für created_by)
  const [adminUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "admin"))
    .limit(1);

  const userId = adminUser?.id || 1;

  console.log(
    `🚀 Importiere ${pages.length} Seiten in Workspace ${workspaceId}...`,
  );
  console.log("");

  const result = await importWeKnoraPages(workspaceId, pages, userId);

  console.log("");
  console.log("━━━ Import-Ergebnis ━━━");
  console.log(`✅ Importiert: ${result.imported}`);
  console.log(`⏭️  Übersprungen: ${result.skipped}`);

  if (result.errors.length > 0) {
    console.log("");
    console.log("⚠️ Fehler:");
    for (const err of result.errors.slice(0, 10)) {
      console.log(`   ❌ ${err}`);
    }
    if (result.errors.length > 10) {
      console.log(`   ... und ${result.errors.length - 10} weitere`);
    }
  }

  console.log("");
  console.log("✨ Fertig!");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Unerwarteter Fehler:", err);
  process.exit(1);
});
