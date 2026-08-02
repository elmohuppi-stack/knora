# Optimierung knora — 2. August 2026

Alle Befunde und Maßnahmen, die knora betreffen, aus dem Server-Durchlauf vom
2. August 2026. Der serverweite Kontext (Datenbank-Konsolidierung am 1. August,
alle 24 Befunde über alle Apps) steht im Nachbarrepo `optimize-hetzner`,
insbesondere in dessen `OFFENE-PROBLEME.md`. Dieses Dokument ist der
knora-Ausschnitt und die Umsetzungs-Historie dazu.

> **Stand: alle 17 Maßnahmen sind umgesetzt und auf dem Live-Server
> nachgewiesen.** Am 2. August abends wurden 28 Einzelprüfungen gegen den
> laufenden Server gefahren (Indexe, Collations, Extensions, Rollen und Rechte,
> Container-Zustand, Dateirechte, nginx, Backup) — alle bestanden. Was **nicht**
> knora-spezifisch und weiterhin offen ist, steht unter
> [Offen geblieben](#offen-geblieben).

**Ausgangspunkt:** knoras Datenbank läuft seit dem 1. August nicht mehr im
eigenen Compose-Stack, sondern in einer gemeinsamen Postgres-Instanz
(Container `pg-shared`), die auch mediathek, umami und mathe-quiz bedient. Das
Datenverzeichnis wurde dabei unverändert übernommen — knora wurde nicht
migriert. Seit dem 2. August verbindet sich knora über den kanonischen Namen
`pg-shared`; der Alt-Alias `knora-db` existiert im Netz weiter, weil mediathek
noch daran hängt.

**Methodik:** Alle Performance-Aussagen sind mit `EXPLAIN (ANALYZE, BUFFERS)`
gegen die Live-Datenbank gemessen, nicht geschätzt. Zustandsangaben stammen aus
`docker inspect`, `psql` und `pg_stat_*`.

---

## Übersicht

| # | Maßnahme | Kategorie | Wo | Live nachgewiesen durch |
|---|---|---|---|---|
| 1 | Wiki-Suche: Trigramm-Index gegen 1.200-ms-Seq-Scan | Performance | Migration `0008` | `EXPLAIN` zeigt BitmapOr, 1,45 ms |
| 2 | HNSW-Index als ausführbare Migration statt Kommentar | Robustheit | Migration `0009` | Index vorhanden und gültig |
| 3 | Technische Identifikatoren auf `COLLATE "C"` | Datenverlust | Migration `0010` | 5 Spalten mit `collation_name = C` |
| 4 | Auffälligkeiten-Facette nutzt ihren GIN-Index | Performance | `service/wiki.ts` | 0,69 ms, 7 Marker zeilengleich |
| 5 | `/health` prüft die Datenbankverbindung mit | Betrieb | `index.ts` | liefert `{"status":"ok","db":"ok"}` |
| 6 | Healthchecks für alle drei Dauerdienste | Betrieb | `docker-compose.yml` | app, frontend, parser je `healthy` |
| 7 | `mem_limit` für den `frontend`-Container | Betrieb | `docker-compose.yml` | `HostConfig.Memory = 134217728` |
| 8 | Pflichtvariablen statt stiller Default-Secrets | Sicherheit | `docker-compose.yml` | kein Default-Secret in der Container-Umgebung |
| 9 | `knora-api.elmarhepp.de` aus Skript und Doku entfernt | Aufräumen | `deploy.sh`, `docs/` | keine Referenz mehr im Repo |
| 10 | `pg_stat_statements` + `amcheck` in der knora-DB | Diagnose | Server | beide in `pg_extension` |
| 11 | `.env` auf Mode `600` | Sicherheit | Server | `stat -c %a` = 600 |
| 12 | knora nicht mehr unter `openclaw.elmarhepp.de` erreichbar | Sicherheit | Server (nginx) | Symlink weg, Domain liefert nichts mehr |
| 13 | Tägliches Backup **der gesamten Instanz** | Datenverlust | Server | Dump + Restore-Test über alle 4 DBs |
| 14 | Überwachung des Backups (täglich 8:15) | Betrieb | Server | `check-backup.sh` installiert, läuft durch |
| 15 | App-Rolle `knora_app` statt Superuser `knora` | Sicherheit | DB + `.env` | App verbunden als `knora_app`, kein Superuser |
| 16 | Verbindung über den kanonischen Host `pg-shared` | Aufräumen | `docker-compose.yml` | `@pg-shared:5432` in der Umgebung |
| 17 | `CONNECT` auf die knora-DB für PUBLIC entzogen | Sicherheit | DB | `datacl` = `=T` statt `=Tc` |

Alle Änderungen an Code, Migrationen und Compose sind in `main` (Commits
`af2b988`, `2fabb6a`, `add0905`, `28d89d3`, `0494474`, `d5a8185`); der Server
steht auf demselben Stand mit sauberem Arbeitsverzeichnis.

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

## 13–14. Backup der gesamten Instanz, mit Überwachung

> **Wichtig zur Einordnung: Das Backup ist nicht knora-spezifisch.** Es sichert
> per `pg_dumpall` den **kompletten Postgres-Cluster** — alle vier Datenbanken
> und alle Rollen. Dass es in diesem Dokument steht, liegt daran, dass knora mit
> 1,27 von 1,31 GB der weitaus größte Anteil daran ist und der Anlass war.
> Zuständig ist der Nachbarrepo-Eintrag `optimize-hetzner`, Punkt 1.
>
> Zwei Details, die den gegenteiligen Eindruck erwecken, es aber nicht belegen:
> `-U knora` im Skript ist die **Anmelderolle** (die Bootstrap-Rolle des
> Clusters), keine Datenbankauswahl — `pg_dumpall` hat gar keinen
> Datenbank-Filter. Und `/var/backups/pg-shared/` heißt nach der **Instanz**,
> nicht nach einer App.

**Befund.** Es gab keinen automatischen Dump — weder Cron noch systemd-Timer.
Für knora hat es **nie einen gegeben**: Bei der Konsolidierung wurden die drei
kleinen Datenbanken per `pg_dump` umgezogen, knoras Datenverzeichnis dagegen
unverändert übernommen. Die Sicherung unter `/var/backups/consolidation` ist
6,2 MB groß; 1,3 GB passen dort nicht hinein.

Der Wiki-Bestand ist über Monate LLM-generiert. Ein Verlust wäre nicht durch
Re-Import zu ersetzen, sondern nur durch einen neuen Generierungslauf — und die
68.887 Embeddings sind bezahlte LLM-Aufrufe.

**Maßnahme (13).** `/usr/local/sbin/pg-shared-backup` (Mode `700`), täglich um
3:30 über `/etc/cron.d/pg-shared-backup`. Das Skript bricht bei jedem Fehler ab,
prüft die Größe gegen eine Untergrenze, testet das Archiv mit `gzip -t` und
räumt alte Dumps erst auf, **nachdem** der neue validiert ist. Aufbewahrung
14 Tage. Skript, Prüfskript und Restore-Test liegen im Nachbarrepo unter
`deploy/pg-shared/`, dort steht auch die ausführliche Begründung.

**Maßnahme (14).** `pg-shared-check-backup`, täglich um 8:15. Es prüft das
*Ergebnis* statt den Lauf: Ist `.last-success` jünger als 26 Stunden, liegt
überhaupt ein Dump da, ist er groß genug, reicht der Platz für den nächsten? Das
fängt die stille Fehlerart ab — cron läuft gar nicht, Docker-Socket weg, Platte
voll. Es schweigt, solange alles stimmt.

**Was der Dump enthält** (am liegenden Archiv nachgezählt):

| | |
|---|---|
| Datenbanken | `knora` (15 Tabellen), `mediathek` (30), `umami` (18), `mathe_quiz` (4) |
| Rollen | `knora`, `knora_app`, `mediathek`, `umami`, `mathe_user` — inkl. SCRAM-Hashes |
| Größe gepackt | ~485 MB — die Embedding-Vektoren dominieren |
| Laufzeit | 1 min 37 s |

**Restore-Test am 2. August bestanden.** Zurückgespielt in einen isolierten
Wegwerf-Container, keine Fehler, Zeilenabgleich Live ↔ Restore über **alle vier**
Datenbanken: knora 77.028 · mediathek 78.207 · umami 381 · mathe_quiz 4 —
identisch. Der HNSW-Vektorindex wird dabei übersprungen: sein Aufbau kostet auf
diesem Host Minuten und viel Speicher, und er ist ein abgeleitetes Artefakt,
seit Migration `0009` aus dem Repo reproduzierbar. Getestet wird, ob die *Daten*
vollständig und einspielbar sind.

**Was der Dump nicht abdeckt:** alles außerhalb von Postgres — die SQLite-Apps
(finanzen, elmo-scanner, pick-the-place), mediatheks Redis, nginx-Configs,
Zertifikate, `.env`-Dateien, hochgeladene Dateien. Diese Schicht deckt das
Hetzner-Backup-Add-on ab (Image der ganzen Platte, 7 Slots). Die beiden ergänzen
sich: das Image für „Host kaputt", der Dump für „eine Datenbank zurückholen,
ohne die anderen zehn Apps mitzudrehen".

> **Platzbedarf beachten:** 485 MB × 14 Tage ≈ 6,8 GB. Bei aktuell 51 GB frei
> unkritisch, aber es ist der größte einzelne Posten, der ab jetzt wächst.

---

## 15–17. Rollentrennung, kanonischer Host, Abschottung

**Befund.** Die Rolle, mit der sich die App verband, war SUPERUSER — sie umgeht
sämtliche Rechteprüfungen, hatte damit Vollzugriff auf mediathek, umami und
mathe_quiz und konnte über `COPY … FROM PROGRAM` Befehle im Datenbank-Container
ausführen. Vor der Konsolidierung folgenlos (eine Instanz, eine Datenbank), seit
dem 1. August nicht mehr.

Einfach entziehen ging nicht: `knora` ist die einzige Superuser-Rolle im
Cluster und Eigentümerin der Datenbanken `knora`, `postgres` und `template1`.

**Maßnahme.** Neue Rolle `knora_app` (kein Superuser, kein CREATEDB, kein
CREATEROLE) als Eigentümerin der Anwendungsobjekte; `knora` bleibt
Wartungsrolle. Passwort mit `openssl rand -hex 24` auf dem Server erzeugt und
nie durch ein Terminal geschickt — **hex statt base64**, weil `+`, `/` und `=`
in einer `postgresql://`-URL prozentkodiert werden müssten.

**Kein `REASSIGN OWNED`.** Das hätte laut Postgres-Dokumentation auch die
geteilten Objekte übertragen, also die drei Datenbanken — die neue,
unprivilegierte Rolle hätte sie löschen dürfen. Stattdessen eine Schleife, die
gezielt auswählt, was **nicht** zu einer Extension gehört:

| | Anzahl | Eigentümer danach |
|---|---|---|
| Anwendungstabellen (`public` + `drizzle`) | 15 | `knora_app` |
| Sequenzen | 5 | `knora_app` (folgen ihrer Tabelle) |
| Extension-Funktionen (`vector`, `pg_trgm`, `amcheck`, `pg_stat_statements`) | 160 | `knora` — **unangetastet** |
| Extension-Views | 2 | `knora` — **unangetastet** |
| Datenbanken `knora`, `postgres`, `template1` | 3 | `knora` — **unangetastet** |

Zwei Dinge, die dabei auffielen:

- **Serial-Sequenzen lassen sich nicht einzeln umhängen** („is linked to
  table"). Sie folgen ihrer Tabelle automatisch; der erste Anlauf brach
  deswegen ab und rollte vollständig zurück. Die Schleife überspringt sie jetzt
  über ihre `deptype = 'a'`-Abhängigkeit.
- **Die knora-Datenbank erlaubte PUBLIC das Verbinden** (`datacl` war `=Tc`,
  bei den drei anderen `=T`). Beim Umbau wurde `REVOKE CONNECT … FROM PUBLIC`
  nur auf die wiederhergestellten Datenbanken angewandt — knora war
  übersprungen worden, weil es als Volume übernommen und nicht restauriert
  wurde. Damit konnten sich `mediathek`, `umami` und `mathe_user` mit der
  knora-Datenbank verbinden. Nachgeholt; `knora_app` hat ein explizites
  `CONNECT`.

**Rechte, die gesetzt wurden:** `CONNECT` auf die Datenbank, `USAGE, CREATE` auf
`public` (das Schema gehört `pg_database_owner`, nicht der App-Rolle — ohne
`CREATE` scheitert jede Migration, die einen Index anlegt), Eigentum am Schema
`drizzle`, und Default-Privilegien, damit von `knora` bei Wartung angelegte
Objekte für die App benutzbar bleiben.

**Vor der Umstellung getestet** — die neue Rolle wurde geprüft, solange die App
noch mit der alten lief:

| Muss gehen | |
|---|---|
| Verbinden, `SELECT` | ✓ |
| `INSERT` / `UPDATE` / `DELETE` | ✓ |
| Sequenzen benutzen | ✓ |
| DDL: `CREATE TABLE`, `ALTER TABLE`, `CREATE INDEX`, `DROP` | ✓ (die Migrationen brauchen es) |
| Migrationstabelle in `drizzle` beschreiben | ✓ |

| Darf nicht gehen | |
|---|---|
| Verbinden zu `mediathek`, `umami`, `mathe_quiz` | verweigert |
| `COPY … TO PROGRAM` (Befehlsausführung) | verweigert |

**Kanonischer Host (16).** `DATABASE_URL` zeigt nicht mehr auf den Alt-Alias
`knora-db`, sondern auf `pg-shared`. Der Alias bleibt im `hetzner-network`
bestehen, weil mediathek noch daran hängt — knora braucht ihn nicht mehr.

> **Abhängigkeit, die man leicht übersieht:** `pg_dumpall -U knora` im
> Backup-Skript braucht `knora` weiterhin als Superuser — nur so landen alle
> vier Datenbanken *und* die Rollen im Dump. Die Rolle behält den Superuser
> deshalb bewusst; sie wird nur nicht mehr von der App benutzt.

---

## Offen geblieben

### Serverweit, wirkt auf knora

Nichts davon ist knora-spezifisch — alle Punkte liegen im Nachbarrepo
`optimize-hetzner`, hier stehen sie nur, weil sie auf knora durchschlagen:

- **`libc6`-Update und Reboot stehen aus.** Danach `amcheck` über alle
  Datenbanken; bei Befund `REINDEX` und
  `ALTER DATABASE … REFRESH COLLATION VERSION`. Die wichtigsten Textschlüssel
  sind durch Maßnahme 3 bereits immun, und das Backup steht — das war die
  Voraussetzung dafür, diesen Schritt überhaupt anzugehen.
- **Docker-Logs ohne Rotation.** `knora-frontend-1` hat 28 MB, keine
  `/etc/docker/daemon.json`. Greift erst für neu erstellte Container, also
  rollierend nachzuziehen.
- **Der Alias `knora-db`** bleibt im `hetzner-network`, bis auch mediathek auf
  `pg-shared` umgestellt ist. knora hängt nicht mehr daran.

### Beobachtungen, die noch keine Maßnahme sind

- **Die Index-Zähler auf `wiki_pages` sind zurückgesetzt.** Migration `0010`
  schreibt die Tabelle neu und baut die Indexe dabei mit auf; `pg_stat_user_indexes`
  fängt für diese Tabelle wieder bei null an. Eine belastbare Aussage darüber,
  welche Indexe wirklich ungenutzt sind, braucht deshalb ein paar Tage echten
  Verkehr. Vorher gemessen waren es drei — zwei davon sind durch Maßnahme 1
  und 4 erklärt und werden jetzt benutzt.
- **Die lokale Dev-Datenbank ist abgedriftet.** In `drizzle.__drizzle_migrations`
  stehen nur `0000` und `0001`, das Schema hat aber 14 Tabellen — der Rest wurde
  per `db:push` eingespielt. `bun run db:migrate` scheitert dort mit „column
  already exists", unabhängig von diesen Änderungen. Die neuen Migrationen
  wurden deshalb lokal per `psql` getestet. Sollte geradegezogen werden, sonst
  ist die Migrationskette lokal unbenutzbar.

---

## Verifikation

**Abnahme am 2. August, abends: 28 Prüfungen gegen den laufenden Server, alle
bestanden.**

| Bereich | geprüft |
|---|---|
| Server-Repo | sauber, auf `origin/main` |
| Migrationen | Trigramm- und HNSW-Index vorhanden, `COLLATE C` auf 5 Spalten, keine ungültigen Indexe |
| Extensions | `pg_trgm`, `amcheck`, `pg_stat_statements`, `vector` |
| Rolle | `knora_app` ohne Superuser/CREATEDB, besitzt 20 Objekte, DB gehört weiter `knora`, PUBLIC ausgesperrt, App verbunden als `knora_app` |
| Container | alle drei `healthy`, frontend auf 128 MB, `@pg-shared:5432`, kein Default-Secret |
| Rechte/nginx | `.env` `600`, openclaw-Symlink weg, Config erhalten |
| Backup | beide Skripte `700`, zwei Cron-Jobs, Dumps vorhanden, Prüfung läuft durch |
| Laufender Code | `/health` liefert `{"status":"ok","db":"ok"}` — nur im neuen Image vorhanden |

Zum Nachfahren:

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
| Indexe auf `wiki_pages`, die der Planner nutzen *kann* | 5 von 7 | **8 von 8** |
| Healthchecks | keine | app, frontend, parser je `healthy` |
| `/health` | statisches `ok` | `{"status":"ok","db":"ok"}`, 503 bei DB-Ausfall |
| Container ohne `mem_limit` | 1 (frontend) | 0 |
| Default-Secrets als Fallback | 2 | 0 |
| `.env`-Rechte | `644` | `600` |
| knora unter fremder Domain erreichbar | ja (openclaw) | nein |
| App-Rolle | SUPERUSER, Zugriff auf alle 4 DBs | `knora_app`, nur die eigene DB |
| PUBLIC darf sich mit der knora-DB verbinden | ja | nein |
| Backup des Clusters | keins, nie eines gegeben | täglich, überwacht, Restore geprüft |
| btree-Indexe per `amcheck` geprüft | nicht möglich (Extension fehlte) | 27, fehlerfrei |

Zur vorletzten Zeile in der Index-Zeile: „nutzen können" statt „genutzt", weil
die Zähler durch Migration `0010` zurückgesetzt wurden (siehe
[Beobachtungen](#beobachtungen-die-noch-keine-maßnahme-sind)). Vorher waren
`wiki_pages_fts_idx` und `wiki_pages_metadata_gin_idx` bei `idx_scan = 0`,
obwohl der Code sie adressierte — genau das haben Maßnahme 1 und 4 behoben.
`wiki_pages_out_links_gin_idx` war schon vorher korrekt geschrieben, wird aber
selten aufgerufen.
