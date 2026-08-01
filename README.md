# Knora

[![GitHub](https://img.shields.io/badge/GitHub-elmohuppi--stack/knora-2e6cc4?logo=github)](https://github.com/elmohuppi-stack/knora)

> **Dein persönlicher Second Brain – AI-native Wissensdatenbank mit Wiki und Chat**

Knora ist eine schlanke, moderne Web-App, die Dokumente, Webseiten und YouTube-Videos in eine durchsuchbare Wissensdatenbank verwandelt.  
Stell Fragen via RAG-Chat **und** bekomme ein automatisch generiertes, verlinktes Wiki – alles editierbar im TipTap-Editor.

**TypeScript End-to-End** – Vue 3 Frontend + Bun/Hono Backend + PostgreSQL/pgvector.

---

## ✨ Features

| Feature                 | Beschreibung                                         |
| ----------------------- | ---------------------------------------------------- |
| **📄 Dokument-Import**   | Markdown, Text, PDF, DOCX, HTML u.a. über den Parser-Service – auch **große Dateien** (Upload-/Timeout-/RAM-Limits angehoben) |
| **🔍 Hybride Suche**     | Vektor-Embeddings (pgvector) + Volltext (tsvector)   |
| **💬 RAG Chat**          | Frage zu deinen Dokumenten mit Quellenangaben, SSE-Streaming, **Gesprächsverlauf-Kontext** & Historie (Sessions löschbar) |
| **📖 Wiki-Generierung**  | LLM erstellt Summary-/Entity-/Concept-Seiten – **kapitelweise über das ganze Dokument** (nicht nur den Anfang) |
| **🧩 Chat → Wiki-Verbund** | Aus einem Gespräch einen ganzen Artikel-Verbund erzeugen: **1 Summary + n Concepts + m Entities**, untereinander verlinkt. Zielgruppe/Stil/Umfang im Chat entwickeln; das Transkript wird als Quell-Dokument gespeichert; Entwürfe im Review prüfen & veröffentlichen |
| **🎚️ Wiki-Tiefe**        | Pro Workspace steuerbar (`full`/`capped`/`summary`/`off`) – Kosten vs. Detailtiefe bei großen Dokumenten |
| **🔗 Verlinktes Wiki**   | `[[Slug]]`-Links zwischen Wiki-Seiten                |
| **✏️ Artikel-Editor**    | Markdown-Editor (Titel/Summary/Inhalt); **Versionshistorie** & **Lock** backend-seitig (`wiki_page_revisions`, Restore-Endpoint, `manually_edited` – Auto-Generierung überschreibt Handedits nicht) |
| **🔊 Vorlesen**          | Ganze Artikel per Browser-Stimme vorlesen (Web Speech API, kein Backend/keine Kosten): Play/Pause, Absatz vor/zurück, Tempo & Stimme wählbar. Markdown wird für die Sprachausgabe aufbereitet – `[[Links]]` als Klartext, URLs raus, Code/Tabellen werden angesagt statt vorgelesen |
| **🎛️ Filter & Facetten** | Dokumente/Wiki nach Typ, Kanal, Datum, Volltext filtern & sortieren; adaptives Discovery-Layout (Karten-Grid) |
| **🏷️ Themen pro Workspace** | Datenbasierte Themen-Vorschläge (LLM-Clustering der Konzepte), Auto-Klassifikation + manuelle Zuweisung, Themen-Filter |
| **🔎 Backlink-Filter**   | Concept/Entity → alle referenzierenden Artikel; „Top-Konzepte"-Facette |
| **🕸️ Wiki-Graph**        | D3-Force-Graph: Fokus-Subgraph (statt Hairball), Klick auf Knoten → Seiten-Panel mit Artikel |
| **🎥 YouTube-Import**    | Transkript → automatische Wiki-Seite; Kanal/Datum/Dauer/Tags als Metadaten |
| **🌐 URL-Import**        | Webseite laden (Browser-Header, Redirect-Follow) → MarkItDown → Markdown → Chunks, asynchron im Hintergrund |
| **📊 Activity-Log**      | Workspace-gefilterte Aktivitäten (Import, Wiki-Generierung …) in einer dezenten App-weiten Log-Leiste |
| **📥 WeKnora-Migration** | Dokumente, generierte Artikel & Embeddings 1:1 übernehmen |
| **📱 Responsive**        | Handy-taugliche UI: Bottom-Nav, Master/Detail-Wiki, Chat-Verlauf als Drawer |
| **🔐 Auth**              | JWT + bcrypt, Rollen: Admin / Editor / Viewer        |

---

## 🛠️ Tech-Stack

| Komponente       | Technologie                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------- |
| **Backend**      | [Bun](https://bun.sh) + [Hono](https://hono.dev)                                            |
| **API**          | REST + [`@hono/zod-validator`](https://hono.dev/docs/guides/validation)                     |
| **Frontend**     | [Vue 3](https://vuejs.org) + [Vite](https://vitejs.dev) + TypeScript                        |
| **UI-Library**   | [PrimeVue](https://primevue.org) 4                                                          |
| **State**        | [Pinia](https://pinia.vuejs.org)                                                            |
| **ORM**          | [Drizzle](https://orm.drizzle.team)                                                         |
| **Datenbank**    | [PostgreSQL](https://www.postgresql.org) + [pgvector](https://github.com/pgvector/pgvector) |
| **LLM**          | [Vercel AI SDK](https://sdk.vercel.ai/docs) (SSE-Streaming)                                 |
| **Wiki-Editor**  | Einfacher Markdown-Editor ([TipTap](https://tiptap.dev) als Dependency installiert für späteres WYSIWYG, noch nicht im UI verdrahtet) |
| **Wiki-Graph**   | [D3.js](https://d3js.org) (d3-force)                                                        |
| **Shared Types** | `packages/shared/` (TypeScript End-to-End)                                                  |

---

## 🚀 Quickstart

### Voraussetzungen

- [Bun](https://bun.sh) (v1.2+)
- [Docker](https://www.docker.com) & [Docker Compose](https://docs.docker.com/compose/)
- [Node.js](https://nodejs.org) (für Shared-Package, falls nötig)

### 1. Repository klonen

```bash
git clone https://github.com/elmohuppi-stack/knora.git
cd knora
```

### 2. Umgebungsvariablen

```bash
cp .env.example .env
# .env anpassen: Datenbank-Zugang, JWT-Secret, LLM-API-Keys
```

### 3. Datenbank starten

```bash
# Lokale Dev-DB (Port 5432). Die Prod-Compose enthält keinen db-Service mehr,
# dort läuft Postgres als gemeinsame Instanz außerhalb dieses Stacks.
docker compose -f docker-compose.dev.yml up -d db
```

### 4. Abhängigkeiten installieren

```bash
bun install
```

### 5. Datenbank migrieren & seeden

```bash
cd backend
bun run db:migrate
bun run db:seed   # Erstellt Admin-User (admin@knora.dev / admin123)
cd ..
```

### 6. Entwicklungs-Server starten

```bash
# Backend (Hot-Reload)
bun run dev &

# Frontend (Vite HMR)
cd frontend && bun run dev
```

Öffne **http://localhost:5173** im Browser.

---

## 🏗️ Projektstruktur

```
knora/
├── backend/                  # Bun + Hono API Server
│   ├── src/
│   │   ├── index.ts          # Server-Einstieg
│   │   ├── db/
│   │   │   ├── schema.ts     # Drizzle-Datenbank-Schema
│   │   │   ├── index.ts      # DB-Connection
│   │   │   ├── migrate.ts    # Migrationen
│   │   │   └── seed.ts       # Admin-Seed
│   │   ├── middleware/
│   │   │   └── auth.ts       # JWT-Auth-Middleware
│   │   ├── router/           # REST-Routen
│   │   │   ├── auth.ts
│   │   │   ├── admin.ts
│   │   │   ├── workspace.ts
│   │   │   ├── document.ts    # Upload, URL-Import, YouTube
│   │   │   ├── chat.ts
│   │   │   ├── wiki.ts
│   │   │   ├── search.ts
│   │   │   ├── topic.ts       # Themen pro Workspace
│   │   │   ├── activity.ts    # Activity-Log
│   │   │   └── model.ts
│   │   ├── service/          # Business-Logik
│   │   │   ├── auth.ts
│   │   │   ├── document.ts
│   │   │   ├── embedding.ts
│   │   │   ├── search.ts
│   │   │   ├── wiki.ts
│   │   │   ├── wiki-from-chat.ts  # Chat → Artikel-Verbund
│   │   │   └── ...
│   │   └── scripts/
│   │       ├── weknora-db-import.ts  # WeKnora DB-Migration (Docs, Wiki, Embeddings)
│   │       ├── embed-backfill.ts     # Batch-Embedding-Backfill
│   │       └── knora-import.ts       # WeKnora JSON-Import (API-Export)
│   ├── drizzle.config.ts
│   └── Dockerfile
│
├── frontend/                 # Vue 3 + Vite SPA
│   ├── src/
│   │   ├── main.ts
│   │   ├── App.vue
│   │   ├── router/index.ts
│   │   ├── stores/           # Pinia-Stores
│   │   ├── views/            # Seiten
│   │   │   ├── auth/
│   │   │   ├── chat/
│   │   │   ├── wiki/
│   │   │   ├── documents/
│   │   │   ├── workspace/
│   │   │   └── admin/
│   │   └── components/       # Wiederverwendbare Komponenten
│   │       ├── ActivityBar.vue  # App-weite Activity-Log-Leiste
│   │       └── ConfirmModal.vue
│   │   #  Artikel-Editor (Markdown-Textarea): views/wiki/WikiPage.vue
│   │   #  Wiki-Graph (D3-Force): views/wiki/GraphView.vue
│   ├── nginx.conf
│   └── Dockerfile
│
├── packages/shared/          # TypeScript-Types (Frontend + Backend)
│   └── src/types/
│       ├── user.ts
│       ├── workspace.ts
│       ├── document.ts
│       ├── chunk.ts
│       ├── wiki.ts
│       ├── chat.ts
│       └── model.ts
│
├── parser/                   # MarkItDown (Python) – für PDF/DOCX/HTML-Import, läuft immer mit
│   ├── main.py
│   └── Dockerfile
│
├── docs/
│   ├── PLAN.md                 # Konzept, Architektur & Status
│   ├── deployment-live.md      # Hetzner-Live-Deployment (Knora)
│   └── deployment-standard.md  # Multi-App-Deployment-Standard
│
├── docker-compose.yml        # Produktion
├── docker-compose.dev.yml    # Entwicklung
├── deploy.sh                 # Hetzner-Deployment
└── Makefile
```

---

## 📖 Wiki-Seiten & `[[Links]]`

Wiki-Seiten werden in Markdown geschrieben und können mit `[[Slug]]` auf andere Seiten verlinken:

```markdown
# WeKnora Architecture

WeKnora is built with [[Go]] and [[Gin]].
It uses [[PostgreSQL]] for data storage and [[pgvector]] for embeddings.
```

Der **TipTap-Editor** autocompleted `[[` zu allen existierenden Slugs.  
Der **Wiki-Graph** visualisiert die Verlinkungen als Force-Directed Graph.

---

## 📚 Große Dokumente & Wiki-Tiefe

Große Dokumente (viele hundert Seiten) und lange Video-Transkripte werden **vollständig** verarbeitet:

- **Import-Limits angehoben**: nginx-Body-Size (512 MB), Bun-`maxRequestBodySize` (`MAX_UPLOAD_MB`), Parser-Timeout (`PARSER_TIMEOUT_MS`, gunicorn `--timeout`) und `mem_limit` für app/parser.
- **Embeddings ohne Deckel**: alle Chunks werden embedded (früher stumme Grenze bei 5000) – gebatcht über `EMBED_BATCH_SIZE`.
- **Kapitel-Wiki**: das Dokument wird in ~32k-Zeichen-Kapitel (an Überschriften, Größen-Fallback) zerlegt; Extraktion, Zusammenfassung und Zitate laufen über **alle** Kapitel plus eine Übersichtsseite mit Inhaltsverzeichnis.

Die **Wiki-Tiefe** steuert das Kosten-/Detail-Verhältnis pro Workspace über `wiki_config.wiki_depth` (setzbar via `PUT /api/v1/workspaces/:id`):

| Modus       | Verhalten                                                                       |
| ----------- | ------------------------------------------------------------------------------- |
| `full`      | Alle Entity/Concept-Seiten, kein Deckel                                          |
| `capped` *(Default)* | Entity/Concept-Seiten gedeckelt + Auto-Zusammenfassung bei sehr großen Docs |
| `summary`   | Nur Kapitel-Artikel + Übersicht (keine teuren Entity/Concept-Seiten)            |
| `off`       | Kein Wiki – Dokument bleibt via Chat/RAG durchsuchbar                            |

> Hinweis: Auf sehr kleiner Hardware (z. B. 4-GB-Host) sind tausend-Seiten-PDFs durch den Parser-RAM begrenzt und sollten vorab in Teile gesplittet werden.

---

## 📥 WeKnora-Migration

Bestehende WeKnora-Daten (Dokumente, generierte Artikel und deren Embeddings) lassen sich direkt aus der WeKnora-Postgres-DB übernehmen. Da beide Systeme `text-embedding-3-small` (1536 Dim) nutzen, werden die Dokument-Embeddings **1:1 kopiert** – kein Re-Embedding nötig. Nur die generierten Wiki-Artikel werden in Knora frisch vektorisiert.

```bash
# 1. Export aus der WeKnora-DB (JSONL.gz): knowledges, wiki_pages, embeddings
#    via psql row_to_json (siehe scripts/weknora-export.py bzw. docs/PLAN.md)

# 2. Import in Knora
cd backend
bun run src/scripts/weknora-db-import.ts <export-dir> --owner=<email> [--dry-run]

# 3. Embeddings für die neu importierten Wiki-Artikel nachziehen
bun run src/scripts/embed-backfill.ts
```

Alle `[[Links]]`, Aliase, Quellverweise und Metadaten bleiben erhalten und sind sofort editierbar.
Für einen API-basierten JSON-Export existiert außerdem [`scripts/knora-import.ts`](backend/src/scripts/knora-import.ts).

---

## 🧪 Entwicklung

### Lokale Entwicklung (empfohlen)

```bash
# Services (DB nur)
docker compose -f docker-compose.dev.yml up -d db

# Backend (Hot-Reload)
cd backend && bun run dev

# Frontend (Vite HMR)
cd frontend && bun run dev
```

### Docker-Entwicklung

```bash
docker compose -f docker-compose.dev.yml up -d --build
```

### Datenbank-Migrationen

```bash
cd backend
bun run db:generate   # Neue Migration aus Schema generieren
bun run db:migrate    # Migration anwenden
bun run db:push       # Schema direkt pushen (Dev)
```

---

## 🚢 Deployment

Siehe [`docs/deployment-live.md`](docs/deployment-live.md) (Knora live auf Hetzner) und [`docs/deployment-standard.md`](docs/deployment-standard.md) (Multi-App-Standard).

Kurzfassung:

```bash
./deploy.sh [branch] elmarhepp   # git pull + docker compose up -d --build
```

---

## 📋 Status

Kernfunktionen sind implementiert und live: Auth, Workspaces, Dokument-Import (Upload, URL-Scraping, YouTube; inkl. Parser für PDF/DOCX, auch große Dateien), hybride Suche, RAG-Chat mit Streaming, Verlaufskontext & Historie, kapitelbasierte Wiki-Generierung über das ganze Dokument mit im Frontend steuerbarer Wiki-Tiefe, Chat→Wiki-Artikel-Verbund (Entwurf/Review), Markdown-Artikel-Editor, Wiki-Graph, Filter/Themen/Backlinks, Activity-Log und die WeKnora-Migration.

Offen / optional: Dokumenten-Preview (PDF/Markdown) in der UI, Knowledge-Graph-Pipeline (`graph_enabled`), Web-Suche.

Details & Architektur: [`docs/PLAN.md`](docs/PLAN.md)

---

## 📄 Lizenz

MIT – siehe [LICENSE](./LICENSE).

---

_Inspiriert von [WeKnora](https://github.com/Tencent/WeKnora) (Tencent) – reduziert auf das Wesentliche, erweitert um eine persönliche Vision._
