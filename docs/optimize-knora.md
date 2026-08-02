# Optimierung knora — 2. August 2026

Alle Befunde und Maßnahmen, die knora betreffen, aus dem Server-Durchlauf vom
2. August 2026. Der serverweite Kontext (Datenbank-Konsolidierung am 1. August,
alle 23 Befunde über alle Apps) steht im Nachbarrepo `optimize-hetzner`,
insbesondere in dessen `OFFENE-PROBLEME.md`. Dieses Dokument ist der
knora-Ausschnitt und die Umsetzungs-Historie dazu.

**Ausgangspunkt:** knoras Datenbank läuft seit dem 1. August nicht mehr im
eigenen Compose-Stack, sondern in einer gemeinsamen Postgres-Instanz
(`pg-shared`, Container-Alias `knora-db`), die auch mediathek, umami und
mathe-quiz bedient. Das Datenverzeichnis wurde dabei unverändert übernommen —
knora wurde nicht migriert.

**Methodik:** Alle Performance-Aussagen sind mit `EXPLAIN (ANALYZE, BUFFERS)`
gegen die Live-Datenbank gemessen, nicht geschätzt. Zustandsangaben stammen aus
`docker inspect`, `psql` und `pg_stat_*`.

---

## Übersicht

| # | Maßnahme | Wo | Status |
|---|---|---|---|
| 1 | Wiki-Suche: Trigramm-Index gegen 1.200-ms-Seq-Scan | Migration `0008` | umgesetzt |
| 2 | HNSW-Index als ausführbare Migration statt Kommentar | Migration `0009` | umgesetzt |
| 3 | Technische Identifikatoren auf `COLLATE "C"` | Migration `0010` | umgesetzt |
| 4 | Auffälligkeiten-Facette nutzt ihren GIN-Index | `service/wiki.ts` | umgesetzt |
| 5 | `/health` prüft die Datenbankverbindung mit | `index.ts` | umgesetzt |
| 6 | Healthchecks für alle drei Dauerdienste | `docker-compose.yml` | umgesetzt |
| 7 | `mem_limit` für den `frontend`-Container | `docker-compose.yml` | umgesetzt |
| 8 | Pflichtvariablen statt stiller Default-Secrets | `docker-compose.yml` | umgesetzt |
| 9 | `knora-api.elmarhepp.de` aus Skript und Doku entfernt | `deploy.sh`, `docs/` | umgesetzt |
| 10 | `pg_stat_statements` + `amcheck` in der knora-DB | Server | umgesetzt |
| 11 | `.env` auf Mode `600` | Server | umgesetzt |
| 12 | knora nicht mehr unter `openclaw.elmarhepp.de` erreichbar | Server (nginx) | umgesetzt |
| 13 | Tägliches Datenbank-Backup | Server | umgesetzt |
| — | App-Rolle `knora` ist SUPERUSER | Server | **offen**, siehe unten |
| — | Umstellung auf den kanonischen Host `pg-shared` | Server | **offen**, siehe unten |

---

## 1. Wiki-Suche: 280× langsamer als nötig

**Befund.** Der GIN-Index `wiki_pages_fts_idx` (13 MB) stand auf `idx_scan = 0`,
während `wiki_pages` 8.119 Seq-Scans zählte. Ursache: In `getWikiPages()` stand
neben dem Volltext-Zweig ein `ilike(title, '%q%')`. Ein `ilike` mit führendem
`%` ist nicht indexierbar — und dadurch fiel die **gesamte** OR-Bedingung auf
einen Filter zurück, der Volltextindex konnte nie greifen.

Gemessen (5.703 Wiki-Seiten, Suchwort „Maske"):

| Variante | Plan | Zeit |
|---|---|---|
| wie zuvor (FTS `OR` ilike) | Index Scan + Filter, 3.159 Zeilen verworfen | **1.200 ms** |
| nur der FTS-Zweig | BitmapAnd über `wiki_pages_fts_idx` | **4,3 ms** |

**Maßnahme.** Migration `0008_wiki_search_trgm.sql`: `pg_trgm`-Extension und ein
GIN-Trigramm-Index auf `wiki_pages.title`. Damit sind **beide** OR-Zweige
indexierbar und der Planner kann sie zu einem BitmapOr verbinden. Der
LIKE-Zweig bleibt erhalten — er ist für Kürzel wie „FG36" und Slug-Fragmente
gewollt, die `websearch_to_tsquery` nicht findet.

**Nachgemessen nach der Umsetzung.** Der Plan kippt wie erhofft — statt eines
Filters steht dort jetzt ein `BitmapOr` über **beide** Indexe:

```
Bitmap Heap Scan on wiki_pages
  ->  BitmapAnd
        ->  Bitmap Index Scan on wiki_pages_parent_idx        (workspace_id)
        ->  BitmapOr
              ->  Bitmap Index Scan on wiki_pages_fts_idx          (Volltext)
              ->  Bitmap Index Scan on wiki_pages_title_trgm_idx   (ILIKE)
```

| | vorher | nachher (kalt) | nachher (warm) |
|---|---|---|---|
| Ausführungszeit | 1.200 ms | 10,0 ms | **1,45 ms** |

---

## 2. Der HNSW-Index existierte nur als Kommentar

**Befund.** In `0007_search_indexes.sql` stand der Vektorindex auskommentiert,
mit dem sachlich richtigen Hinweis, ihn erst nach dem Embedding-Lauf anzulegen.
Genau das passierte nie — bis er beim Server-Umbau am 1. August manuell
angelegt wurde (541 MB, 741 ms → 12,4 ms). In der Migrationskette fehlte er
weiter.

**Warum das zählt.** Ein Restore aus dem Dump, ein frischer Aufbau oder eine
zweite Instanz hätte ihn wieder nicht — und das fällt genauso lange nicht auf
wie beim ersten Mal, weil nichts fehlschlägt, es wird nur alles langsam.

**Maßnahme.** Migration `0009_hnsw_index.sql` mit `IF NOT EXISTS`. Auf dem
Live-Server ist sie ein No-Op, weil der Index dort schon steht.

> **Warum nicht `CONCURRENTLY` in der Migrationsdatei:** `drizzle-kit migrate`
> führt jede Migration in einer Transaktion aus, und `CREATE INDEX CONCURRENTLY`
> ist dort nicht erlaubt. Die Datei enthält deshalb die normale Form. Bei einer
> großen, bereits befüllten Tabelle den Index vorher von Hand mit `CONCURRENTLY`
> anlegen — dank `IF NOT EXISTS` wird die Migration danach übersprungen. Der
> Hinweis steht auch in der Datei selbst.

---

## 3. Technische Identifikatoren ohne `COLLATE "C"`

**Befund.** Im gesamten Schema kam `COLLATE` nicht vor. Betroffen waren unter
anderem `wiki_pages.slug` und `topics.slug` — beide unter einem UNIQUE-Index —
sowie `users.email` und `sessions.token`.

**Warum das zählt.** Genau diese Konstellation hat in der Nachbar-App mediathek
zwei Indexe zerlegt: Ein Update der Systembibliothek änderte die
Sortierreihenfolge, spätere `INSERT`s suchten unter einer anderen Ordnung als
der Index gebaut war, liefen am vorhandenen Schlüssel vorbei und legten
Duplikate an — **trotz gültigem UNIQUE-Constraint**. Auf dem Server steht ein
`libc6`-Update aus; das ist derselbe Auslöser.

`COLLATE "C"` bedeutet byteweisen Vergleich. Der ist von der Systembibliothek
unabhängig und damit gegen diesen Fehler immun. Bei einem Slug, einem Token oder
einer E-Mail-Adresse als Schlüssel ist sprachabhängige Sortierung ohnehin
bedeutungslos.

**Maßnahme.** Migration `0010_collate_c_identifiers.sql` für:

| Spalte | warum |
|---|---|
| `wiki_pages.slug` | UNIQUE über `(workspace_id, slug)` |
| `wiki_pages.parent_slug` | Index, referenziert Slugs |
| `topics.slug` | UNIQUE über `(workspace_id, slug)` |
| `users.email` | UNIQUE, Anmelde-Schlüssel |
| `sessions.token` | UNIQUE, Sitzungs-Schlüssel |

**Bewusst nicht umgestellt:** die `varchar(36)`-Id-Spalten (`id`,
`workspace_id`, `document_id` …). Sie tragen dasselbe theoretische Risiko, aber
eine Typänderung schreibt die Tabelle komplett neu — bei `chunks` wären das
1,2 GB unter einem `ACCESS EXCLUSIVE`-Lock auf einem Host mit 3,7 GB RAM. Der
Aufwand steht nicht dafür: die **Indexe** auf `chunks` sind klein (1,5 MB und
840 kB; der 541-MB-HNSW ist ein Vektorindex und nicht collation-abhängig), ein
`REINDEX` nach einem glibc-Wechsel ist also billig. Für diese Spalten gilt
Heilung statt Vorbeugung — mit `amcheck` als Nachweis.

> **Nebenwirkung:** `COLLATE "C"` ändert die Sortierreihenfolge bei `ORDER BY`
> auf diesen Spalten (Großbuchstaben vor Kleinbuchstaben). Geprüft: sortiert
> wird im Code nach `title`, `created_at` und `sort_order`, nicht nach Slug,
> Token oder E-Mail.

---

## 4. Auffälligkeiten-Facette nutzte ihren Index nie

**Befund.** Die Facette filterte mit `page_metadata -> 'flags' @> '["…"]'`. Der
Index `wiki_pages_metadata_gin_idx` liegt auf der **ganzen Spalte**
(`jsonb_path_ops`); eine `->`-Extraktion links vom Operator passt nicht dazu:

```
page_metadata -> 'flags' @> '["widerspruch"]'    Seq Scan, 5.703 Zeilen   11,7 ms
page_metadata @> '{"flags":["widerspruch"]}'     Bitmap Index Scan         0,4 ms
```

**Maßnahme.** Schreibweise in `service/wiki.ts` umgestellt. Kein neuer Index
nötig. Die bisherige Eigenschaft bleibt erhalten: je Marker ein eigener
`@>`-Vergleich mit echtem Query-Parameter, keine Interpolation in SQL.

**Gegengeprüft auf Produktivdaten.** Beide Schreibweisen liefern für alle sieben
tatsächlich vorkommenden Marker exakt dieselbe Treffermenge:

| Marker | alt | neu |
|---|---|---|
| `datenluecke` | 259 | 259 |
| `kommunikationsstrategie` | 218 | 218 |
| `politischer_druck` | 149 | 149 |
| `risikobewertung_geaendert` | 93 | 93 |
| `massnahme_ohne_evidenz` | 88 | 88 |
| `abweichung_von_who_ecdc` | 18 | 18 |
| `abweichende_fachliche_position` | 15 | 15 |

Laufzeit nach der Umstellung: **0,69 ms** per Bitmap Index Scan.

Zum Vergleich: `out_links @> '["slug"]'` ein paar Zeilen weiter war bereits
korrekt und nutzt seinen Index (0,5 ms) — unverändert gelassen.

---

## 5. `/health` prüfte die Datenbank nicht

**Befund.** Der Endpunkt gab statisch `{"status":"ok"}` zurück. Am 1. August
zwischen 16:02 und 16:03 lieferte knora 500er, weil die alte DB-Adresse während
der Umstellung verschwand — `/health` meldete in diesem Fenster weiter `ok`.

**Maßnahme.** Der Handler führt jetzt ein `select 1` aus und antwortet bei einem
Fehler mit HTTP 503. Damit hat der Healthcheck aus Maßnahme 6 überhaupt erst
eine Aussage. Ohne Auth erreichbar, damit nginx und Docker ihn abfragen können.

---

## 6–8. Compose: Healthchecks, Speicherdeckel, Pflichtvariablen

**Healthchecks (6).** knora war die einzige App auf dem Server ohne — die
Container meldeten „Up", nie „healthy". Ein hängender Prozess, der den Port noch
hält, fiel damit nicht auf. Jetzt prüfen `app`, `frontend` und `parser` je einen
eigenen Endpunkt.

**`mem_limit` (7).** `app` (768 MB), `parser` (1 GB) und `tools` (512 MB) hatten
einen Deckel, `frontend` nicht. Ohne Limit sucht sich der OOM-Killer sein Opfer
selbst, statt dass der auffällige Container kontrolliert neu startet. Jetzt
128 MB — der laufende Verbrauch liegt bei 1,4 MB.

**Pflichtvariablen (8).** Vorher:

```yaml
DATABASE_URL: …:${DB_PASSWORD:-changeme}@knora-db:5432/knora
JWT_SECRET: ${JWT_SECRET:-dev-secret-change-me}
```

Live war das folgenlos — die `.env` ist gesetzt, der laufende Container hatte
weder `changeme` noch das Default-Secret. Der Fehler ist latent: Verschwindet
die `.env` bei einem Umzug oder vertippt sich jemand bei einem Variablennamen,
startet knora **ohne Fehlermeldung** mit einem JWT-Secret, das im Repo steht —
wer es kennt, stellt sich Admin-Tokens aus. Jetzt bricht der Start mit
`${VAR:?…}` ab, statt still unsicher weiterzulaufen.

`docker-compose.dev.yml` bleibt unberührt; für die lokale Entwicklung sind feste
Werte richtig.

---

## 9. `knora-api.elmarhepp.de` existierte nie

**Befund.** `deploy.sh` und `docs/deployment-live.md` nannten die Adresse als
API-Endpunkt. Sie funktioniert nicht und hat, soweit rekonstruierbar, nie
funktioniert:

- In `sites-available` taucht `knora-api` in keiner nginx-Config auf, auch nicht
  als deaktivierte. Alle anderen Apps haben ihre API-Subdomain dort stehen.
- Das certbot-Zertifikat für knora deckt genau einen Namen ab. Bei den anderen
  Apps decken die Zertifikate beide Namen ab.
- Entscheidend: **knora hat keinen API-Port auf dem Host.** Der `app`-Container
  exponiert nichts; das Frontend proxyt `/api/` intern zu `app:3000`. Ein
  eigener Vhost hätte kein Ziel.

knora ist bewusst anders gebaut als die übrigen Apps: ein Container-Port statt
zwei, der API-Split passiert im Frontend-nginx statt auf dem Host.

**Maßnahme.** Die Adresse aus `deploy.sh` und der Doku entfernt. Kein Vhost
angelegt — er wäre nur ein zweiter Name für denselben Einstiegspunkt.

---

## 10–12. Server-Maßnahmen mit direkter Wirkung auf knora

**Extensions (10).** `pg_stat_statements` war in `pg-shared` per
`shared_preload_libraries` geladen, aber nie per `CREATE EXTENSION` angelegt —
jede Abfrage scheiterte, die Query-Diagnose war unbenutzbar. `amcheck` fehlte in
der knora-DB (nur mediathek hatte es). Beide nachinstalliert; `amcheck` ist die
Voraussetzung, um nach dem anstehenden `libc6`-Update die Indexe zu prüfen.

**Dateirechte (11).** `/var/www/knora/.env` war world-readable (`644`) und
enthält DB-Passwort, `JWT_SECRET` sowie LLM- und Apify-Schlüssel. Jetzt `600`.

**Domain-Kollision (12).** `openclaw.elmarhepp.de` und `knora.elmarhepp.de`
proxten beide auf Port 3081. Weil der openclaw-Stack gestoppt ist, war der Port
frei — und knora wurde unter der fremden Domain mit gültigem Zertifikat
ausgeliefert, für Besucher nicht als Fehler erkennbar. Der openclaw-Vhost ist
deaktiviert; die Config bleibt in `sites-available`, damit sie bei einem
späteren openclaw-Start mit einem freien Port wieder aktiviert werden kann.

---

## 13. Datenbank-Backup

**Befund.** Es gab keinen automatischen Dump — weder Cron noch systemd-Timer.
Für knora hat es **nie einen gegeben**: Bei der Konsolidierung wurden die drei
kleinen Datenbanken per `pg_dump` umgezogen, knoras Datenverzeichnis dagegen
unverändert übernommen. Die Sicherung unter `/var/backups/consolidation` ist
6,2 MB groß; 1,3 GB passen dort nicht hinein.

Der Wiki-Bestand ist über Monate LLM-generiert. Ein Verlust wäre nicht durch
Re-Import zu ersetzen, sondern nur durch einen neuen Generierungslauf.

**Maßnahme.** `/usr/local/sbin/pg-shared-backup` (Mode `700`), täglich um 3:30
über `/etc/cron.d/pg-shared-backup`. Das Skript bricht bei jedem Fehler ab,
prüft die Größe gegen eine Untergrenze, testet das Archiv mit `gzip -t` und
räumt alte Dumps erst auf, **nachdem** der neue validiert ist. Aufbewahrung
14 Tage. Skript und Restore-Test liegen im Nachbarrepo unter
`deploy/pg-shared/`.

**Erster Lauf und Restore-Test am 2. August durchgeführt:**

| | Wert |
|---|---|
| Dumpgröße (gepackt) | 484 MB — die Embedding-Vektoren dominieren |
| Laufzeit | 1 min 37 s |
| Restore in einen Wegwerf-Container | fehlerfrei |
| Zeilenabgleich Live ↔ Restore | knora 77.028 · mediathek 78.207 · umami 381 · mathe_quiz 4 — **alle identisch** |

Beim Restore-Test wird der HNSW-Vektorindex übersprungen: sein Aufbau kostet auf
diesem Host Minuten und viel Speicher, und er ist ein abgeleitetes Artefakt —
seit Migration `0009` aus dem Repo reproduzierbar. Getestet wird, ob die *Daten*
vollständig und einspielbar sind.

> **Platzbedarf beachten:** 484 MB × 14 Tage ≈ 6,8 GB. Bei aktuell 52 GB frei
> unkritisch, aber es ist der größte einzelne Posten, der ab jetzt wächst.

---

## Offen geblieben

### App-Rolle `knora` ist SUPERUSER

Die Rolle, mit der sich die App verbindet, umgeht sämtliche Rechteprüfungen. Sie
hat damit Vollzugriff auf mediathek, umami und mathe_quiz und kann über
`COPY … FROM PROGRAM` Befehle im Datenbank-Container ausführen. Vor der
Konsolidierung war das folgenlos (eine Instanz, eine Datenbank) — jetzt teilen
sich vier Apps eine Instanz.

Einfach entziehen geht nicht: `knora` ist die einzige Superuser-Rolle im
Cluster. Der Weg ist eine zweite, unprivilegierte Rolle `knora_app` für die App,
während `knora` Wartungsrolle bleibt.

**Warum getrennt geplant:** `REASSIGN OWNED BY knora TO knora_app` überträgt
laut Postgres-Dokumentation nicht nur die Tabellen der aktuellen Datenbank,
sondern auch **geteilte Objekte** — und `knora` ist Eigentümerin der Datenbanken
`knora`, `postgres` und `template1`. Nach einem naiven `REASSIGN` dürfte die
neue App-Rolle diese Datenbanken löschen, das Gegenteil des Ziels. Der Schritt
braucht eine explizite Objektliste und eine Probe, kein Einzeiler.

Abgemildert wird das Risiko dadurch, dass die Datenbank auf keinem Host-Port
lauscht und nur über das Docker-Netz erreichbar ist.

### Verbindung über den Alt-Alias `knora-db`

`DATABASE_URL` zeigt auf `knora-db`. Kanonisch wäre `pg-shared`; der Alias
existiert nur, damit knora und mediathek beim Umbau ihre Verbindungsstrings
nicht ändern mussten. Kein Fehler, aber solange er benutzt wird, muss er
gepflegt und erklärt werden. Sinnvoll zusammen mit der Rollentrennung zu
erledigen — beides betrifft dieselbe Zeile in der `.env` und teilt sich einen
Neustart.

### Serverweit, wirkt auf knora

- **`libc6`-Update und Reboot stehen aus.** Danach `amcheck` über alle
  Datenbanken; bei Befund `REINDEX` und
  `ALTER DATABASE … REFRESH COLLATION VERSION`. Die wichtigsten Textschlüssel
  sind durch Maßnahme 3 bereits immun.
- **Docker-Logs ohne Rotation.** `knora-frontend-1` hat 28 MB, keine
  `/etc/docker/daemon.json`. Serverweite Maßnahme.
- **Backup off-site.** Der Dump liegt auf derselben Platte wie die Datenbank.

---

## Verifikation

Nach dem Ausrollen geprüft:

```sh
# Wirkt der Trigramm-Index? (Plan muss BitmapOr statt Filter zeigen)
ssh elmarhepp 'docker exec pg-shared psql -U knora -d knora -c "explain (analyze, costs off)
  select id from wiki_pages where workspace_id = ''<id>''
    and (to_tsvector(''german'', coalesce(title,'''')||'' ''||coalesce(content,'''')) @@ websearch_to_tsquery(''german'',''Maske'')
         or title ilike ''%Maske%'')"'

# Healthchecks grün?
ssh elmarhepp 'docker compose --project-directory /var/www/knora ps'

# /health meldet die DB mit?
curl -s https://knora.elmarhepp.de/health

# Collation gesetzt?
ssh elmarhepp 'docker exec pg-shared psql -U knora -d knora -c "\d+ wiki_pages" | grep slug'

# openclaw liefert nicht mehr knora aus?
curl -s -o /dev/null -w "%{http_code}\n" https://openclaw.elmarhepp.de/
```

## Ergebnis dieses Durchlaufs

Nach dem Ausrollen am 2. August 2026 gemessen:

| | vorher | nachher |
|---|---|---|
| Wiki-Suche (5.703 Seiten, „Maske") | 1.200 ms | **1,45 ms** warm · 10,0 ms kalt |
| Auffälligkeiten-Facette | 11,7 ms Seq Scan | **0,69 ms** Bitmap Index Scan |
| Genutzte Indexe auf `wiki_pages` | 4 von 7 | **6 von 8** |
| Healthchecks | keine | app, frontend, parser je `healthy` |
| `/health` | statisches `ok` | `{"status":"ok","db":"ok"}`, 503 bei DB-Ausfall |
| Container ohne `mem_limit` | 1 (frontend) | 0 |
| Default-Secrets als Fallback | 2 | 0 |
| `.env`-Rechte | `644` | `600` |
| knora unter fremder Domain erreichbar | ja (openclaw) | nein |
| Datenbank-Backup | keins, nie eines gegeben | täglich, mit geprüftem Restore |
| btree-Indexe per `amcheck` geprüft | nicht möglich (Extension fehlte) | 27, fehlerfrei |

Die drei zuvor ungenutzten Indexe sind auf einen geschrumpft: `wiki_pages_fts_idx`
und `wiki_pages_metadata_gin_idx` werden jetzt benutzt. `wiki_pages_out_links_gin_idx`
bleibt bei `idx_scan = 0` — der Index ist korrekt geschrieben und funktioniert
(0,5 ms), die Backlink-Facette wird nur selten aufgerufen.
