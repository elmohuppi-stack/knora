#!/usr/bin/env bun
/**
 * Abnahmeprüfung für den RKI-Protokoll-Bestand.
 *
 * Anders als verify-retrieval.ts, das nur ausgibt, prüft dieses Skript mit
 * Erwartungswerten und beendet sich mit Exit 1, wenn etwas nicht stimmt – damit
 * es nach einem großen Lauf als Torwächter dienen kann statt als Bericht, den
 * man überfliegt.
 *
 * Geprüft wird:
 *   1. Dokumentzahl, Datumsspanne, Gremien-Verteilung
 *   2. keine zwei kanonischen Dokumente auf (Datum, Gremium)
 *   3. Chunks vorhanden, keine ohne Embedding
 *   4. Datumskorrekturen sind angekommen (Januar 2020 ohne Impfstoff-Inhalte)
 *   5. Retrieval nennt die richtige Sitzung als Quelle
 *
 * Usage:
 *   bun run src/scripts/verify-rki.ts --workspace <id|name> [--expect-docs 378]
 */

import { and, eq, sql } from "drizzle-orm";

import { db } from "../db/index.ts";
import { chunks, documents, wikiPages, workspaces } from "../db/schema.ts";
import { hybridSearch } from "../service/search.ts";

const args = process.argv.slice(2);
function argValue(name: string): string | undefined {
  const withEq = args.find((a) => a.startsWith(`--${name}=`));
  if (withEq) return withEq.slice(name.length + 3);
  const i = args.indexOf(`--${name}`);
  if (i >= 0 && args[i + 1] && !args[i + 1].startsWith("--")) return args[i + 1];
  return undefined;
}

const WS_ARG = argValue("workspace") || "RKI Sitzungsprotokolle";
const EXPECT_DOCS = argValue("expect-docs")
  ? parseInt(argValue("expect-docs")!, 10)
  : undefined;

const isUuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(WS_ARG);
const [ws] = await db
  .select()
  .from(workspaces)
  .where(isUuid ? eq(workspaces.id, WS_ARG) : eq(workspaces.name, WS_ARG))
  .limit(1);
if (!ws) {
  console.error(`❌ Workspace nicht gefunden: ${WS_ARG}`);
  process.exit(1);
}

let failed = 0;
let warned = 0;
const ok = (msg: string) => console.log(`  ✅ ${msg}`);
const bad = (msg: string) => {
  console.log(`  ❌ ${msg}`);
  failed++;
};
const warn = (msg: string) => {
  console.log(`  ⚠️  ${msg}`);
  warned++;
};

console.log(`\n📂 ${ws.name} (${ws.id})`);

// ---------------------------------------------------------------------------
// 1. Dokumente
// ---------------------------------------------------------------------------
console.log("\n1) Dokumente");

const [docStats] = await db
  .select({
    total: sql<number>`count(*)::int`,
    von: sql<string>`min(${documents.published_at})::date::text`,
    bis: sql<string>`max(${documents.published_at})::date::text`,
    ohneDatum: sql<number>`count(*) filter (where ${documents.published_at} is null)::int`,
    nichtFertig: sql<number>`count(*) filter (where ${documents.parse_status} <> 'completed')::int`,
    ohneChunks: sql<number>`count(*) filter (where ${documents.chunk_count} = 0)::int`,
  })
  .from(documents)
  .where(eq(documents.workspace_id, ws.id));

console.log(`     ${docStats.total} Dokumente, ${docStats.von} … ${docStats.bis}`);
if (EXPECT_DOCS !== undefined) {
  if (docStats.total === EXPECT_DOCS) ok(`Anzahl wie erwartet (${EXPECT_DOCS})`);
  else bad(`Erwartet ${EXPECT_DOCS} Dokumente, gefunden ${docStats.total}`);
}
if (docStats.ohneDatum === 0) ok("alle Dokumente haben ein Sitzungsdatum");
else bad(`${docStats.ohneDatum} Dokumente ohne published_at`);
if (docStats.nichtFertig === 0) ok("alle Dokumente parse_status=completed");
else bad(`${docStats.nichtFertig} Dokumente nicht completed`);
if (docStats.ohneChunks === 0) ok("kein Dokument ohne Chunks");
else bad(`${docStats.ohneChunks} Dokumente mit chunk_count = 0`);

const byChannel = await db
  .select({
    channel: documents.channel,
    n: sql<number>`count(*)::int`,
  })
  .from(documents)
  .where(eq(documents.workspace_id, ws.id))
  .groupBy(documents.channel)
  .orderBy(sql`count(*) desc`);
console.log(
  "     Gremien: " +
    byChannel.map((c) => `${c.channel ?? "—"} ${c.n}`).join(", "),
);

// ---------------------------------------------------------------------------
// 2. Keine Dubletten auf (Datum, Gremium)
//    Nebenfassungen (Agenda/Entwurf) sind gewollt und werden ausgenommen.
// ---------------------------------------------------------------------------
console.log("\n2) Dubletten");

const dupes = await db
  .select({
    tag: sql<string>`${documents.published_at}::date::text`,
    channel: documents.channel,
    n: sql<number>`count(*)::int`,
    titel: sql<string>`string_agg(${documents.title}, ' | ')`,
  })
  .from(documents)
  .where(
    and(
      eq(documents.workspace_id, ws.id),
      sql`coalesce((${documents.source_metadata} ->> 'is_secondary')::boolean, false) = false`,
    ),
  )
  .groupBy(sql`${documents.published_at}::date`, documents.channel)
  .having(sql`count(*) > 1`);

if (dupes.length === 0) {
  ok("keine zwei Hauptfassungen auf (Datum, Gremium)");
} else {
  for (const d of dupes) bad(`${d.tag} / ${d.channel}: ${d.n}× → ${d.titel}`);
}

const secondaries = await db
  .select({ n: sql<number>`count(*)::int` })
  .from(documents)
  .where(
    and(
      eq(documents.workspace_id, ws.id),
      sql`(${documents.source_metadata} ->> 'is_secondary')::boolean = true`,
    ),
  );
console.log(`     Nebenfassungen (gewollt): ${secondaries[0]?.n ?? 0}`);

// ---------------------------------------------------------------------------
// 3. Chunks und Embeddings
// ---------------------------------------------------------------------------
console.log("\n3) Chunks und Embeddings");

const [chunkStats] = await db
  .select({
    total: sql<number>`count(*)::int`,
    ohneEmbedding: sql<number>`count(*) filter (where ${chunks.embedding} is null)::int`,
    wikiChunks: sql<number>`count(*) filter (where ${chunks.document_id} like 'wiki--%')::int`,
    avgLen: sql<number>`round(avg(length(${chunks.content})))::int`,
  })
  .from(chunks)
  .where(eq(chunks.workspace_id, ws.id));

console.log(
  `     ${chunkStats.total} Chunks (${chunkStats.wikiChunks} aus Wiki-Seiten), ø ${chunkStats.avgLen} Zeichen`,
);
if (chunkStats.total > 0) ok("Chunks vorhanden");
else bad("keine Chunks");
if (chunkStats.ohneEmbedding === 0) ok("alle Chunks embedded");
else
  bad(
    `${chunkStats.ohneEmbedding} Chunks ohne Embedding → bun run src/scripts/embed-backfill.ts ${ws.id} --batch=64`,
  );
// Verwaiste Wiki-Chunks: `wiki--<pageId>`-Chunks, deren Seite nicht mehr
// existiert. Sie bleiben in der Vektorsuche auffindbar und erscheinen in
// Zitaten als „Wiki" (der COALESCE-Fallback in search.ts) – Inhalt aus einer
// gelöschten Seite, den niemand mehr nachvollziehen kann.
const [orphans] = await db.execute(sql`
  select count(*)::int as n
  from ${chunks} c
  where c.workspace_id = ${ws.id}
    and c.document_id like 'wiki--%'
    and not exists (
      select 1 from ${wikiPages} w
      where w.id = substring(c.document_id from 7)
    )
`).then((r: any) => r.rows ?? r);
if ((orphans?.n ?? 0) === 0) ok("keine verwaisten Wiki-Chunks");
else
  bad(
    `${orphans.n} Chunks gehören zu gelöschten Wiki-Seiten (erscheinen in Zitaten als „Wiki")`,
  );

// Ein Chunk-Präfix macht ihn selbstidentifizierend; fehlt es, stammt der Chunk
// aus dem alten, blinden Splitter.
const [prefixed] = await db
  .select({ n: sql<number>`count(*)::int` })
  .from(chunks)
  .where(
    and(eq(chunks.workspace_id, ws.id), sql`${chunks.content} like '[%·%]%'`),
  );
if (prefixed.n > 0) ok(`${prefixed.n} Chunks mit Sitzungs-/TOP-Präfix`);
else warn("keine Chunks mit Präfix – stammt der Import aus dem alten Splitter?");

// ---------------------------------------------------------------------------
// 4. Datumskorrekturen angekommen?
//    Die 4 als 2020 abgelegten Sitzungen enthalten Impfstoff-/Varianten-Themen,
//    die im Januar/Februar 2020 nicht existierten. Landen sie im falschen Jahr,
//    ist die Override-Tabelle nicht gegriffen.
// ---------------------------------------------------------------------------
console.log("\n4) Datumskorrekturen");

const [anachron] = await db
  .select({ n: sql<number>`count(*)::int`, titel: sql<string>`string_agg(${documents.title}, ', ')` })
  .from(documents)
  .where(
    and(
      eq(documents.workspace_id, ws.id),
      sql`${documents.published_at} < '2020-11-01'`,
      sql`(${documents.content} ilike '%BioNTech%' or ${documents.content} ilike '%B.1.1.7%' or ${documents.content} ilike '%Impfquote%')`,
    ),
  );
if (anachron.n === 0) {
  ok("kein Dokument vor November 2020 mit BioNTech/B.1.1.7/Impfquote");
} else {
  bad(
    `${anachron.n} Dokument(e) vor 11/2020 mit unmöglichem Inhalt → Datumskorrektur fehlt: ${anachron.titel}`,
  );
}

const [korrigiert] = await db
  .select({ n: sql<number>`count(*)::int` })
  .from(documents)
  .where(
    and(
      eq(documents.workspace_id, ws.id),
      sql`${documents.source_metadata} ->> 'date_source' = 'override'`,
    ),
  );
console.log(`     Dokumente mit Datumskorrektur: ${korrigiert.n}`);

// ---------------------------------------------------------------------------
// 5. Wiki-Artikel
// ---------------------------------------------------------------------------
console.log("\n5) Wiki-Artikel");

const [wikiStats] = await db
  .select({
    summaries: sql<number>`count(*) filter (where ${wikiPages.page_type} = 'summary' and ${wikiPages.slug} not like 'monat-%')::int`,
    monate: sql<number>`count(*) filter (where ${wikiPages.slug} like 'monat-%')::int`,
    entities: sql<number>`count(*) filter (where ${wikiPages.page_type} = 'entity')::int`,
    concepts: sql<number>`count(*) filter (where ${wikiPages.page_type} = 'concept')::int`,
    mitFlags: sql<number>`count(*) filter (where jsonb_typeof(${wikiPages.page_metadata} -> 'flags') = 'array' and jsonb_array_length(${wikiPages.page_metadata} -> 'flags') > 0)::int`,
  })
  .from(wikiPages)
  .where(eq(wikiPages.workspace_id, ws.id));

console.log(
  `     ${wikiStats.summaries} Sitzungsartikel, ${wikiStats.monate} Monatsseiten, ` +
    `${wikiStats.entities} Entities, ${wikiStats.concepts} Concepts, ${wikiStats.mitFlags} mit Auffälligkeiten`,
);
if (wikiStats.summaries === 0) {
  warn("noch keine Sitzungsartikel – rki-wiki-run.ts steht aus");
} else {
  ok(`${wikiStats.summaries} Sitzungsartikel vorhanden`);
}

// Tote Links: [[slug]] ohne Zielseite. Zeigt an, ob stripDeadLinks korrekt
// arbeitet – vor dem Fix wurden gültige Links gelöscht, nicht ungültige behalten.
const [toteLinks] = await db.execute(sql`
  select count(*)::int as n
  from ${wikiPages} w
  cross join lateral jsonb_array_elements_text(w.out_links) as l(slug)
  where w.workspace_id = ${ws.id}
    and jsonb_typeof(w.out_links) = 'array'
    and not exists (
      select 1 from ${wikiPages} t
      where t.workspace_id = ${ws.id} and t.slug = l.slug
    )
`).then((r: any) => r.rows ?? r);
if ((toteLinks?.n ?? 0) === 0) ok("keine toten Wiki-Links");
else warn(`${toteLinks.n} Links zeigen auf nicht existierende Seiten`);

// ---------------------------------------------------------------------------
// 6. Retrieval: nennt die Suche die richtige Sitzung?
// ---------------------------------------------------------------------------
console.log("\n6) Retrieval");

interface Probe {
  frage: string;
  /** Mindestens ein Treffer-Titel muss darauf passen. */
  erwartet: RegExp;
  /** So viele verschiedene Dokumente müssen mindestens auftauchen. */
  minDistinct?: number;
}
const proben: Probe[] = [
  {
    frage: "Warum wurde die ausführliche Risikoeinschätzung nicht veröffentlicht?",
    erwartet: /^2020-01-(1[6-9]|2\d) · AG-nCoV/,
  },
  {
    frage: "Was sagte das RKI zum Entry-Screening an Flughäfen?",
    erwartet: /AG-nCoV|Krisenstab/,
    minDistinct: 2,
  },
  {
    frage: "Wie schätzte die WHO das globale Risiko ein?",
    erwartet: /2020-01|2020-02/,
  },
];

for (const p of proben) {
  const res = await hybridSearch(ws.id, p.frage, 8);
  const titel = [...new Set(res.map((r) => r.document_title))];
  const treffer = titel.some((t) => p.erwartet.test(t));
  console.log(`     ❓ ${p.frage}`);
  console.log(`        → ${titel.slice(0, 4).join(" | ")}`);
  if (res.length === 0) {
    bad("keine Treffer – sind die Embeddings da?");
  } else if (!treffer) {
    warn(`kein Titel passt auf ${p.erwartet}`);
  } else if (p.minDistinct && titel.length < p.minDistinct) {
    warn(`nur ${titel.length} verschiedene Dokumente (erwartet ≥ ${p.minDistinct})`);
  } else {
    ok("Quelle nennt die passende Sitzung");
  }
}

// ---------------------------------------------------------------------------
console.log("\n" + "=".repeat(66));
if (failed === 0 && warned === 0) {
  console.log("✅ Alle Prüfungen bestanden.");
} else {
  console.log(`${failed > 0 ? "❌" : "⚠️ "} ${failed} Fehler, ${warned} Hinweise.`);
}
console.log("=".repeat(66));

process.exit(failed > 0 ? 1 : 0);
