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
| **📄 Dokument-Import**   | Markdown, Text, PDF, DOCX, HTML u.a. über den Parser-Service |
| **🔍 Hybride Suche**     | Vektor-Embeddings (pgvector) + Volltext (tsvector)   |
| **💬 RAG Chat**          | Frage zu deinen Dokumenten mit Quellenangaben, SSE-Streaming, Historie |
| **📖 Wiki-Generierung**  | LLM erstellt Summary-/Entity-/Concept-Seiten aus Dokumenten |
| **🔗 Verlinktes Wiki**   | `[[Slug]]`-Links zwischen Wiki-Seiten                |
| **✏️ TipTap-Editor**     | WYSIWYG-Editor mit `[[slug]]`-Autocompletion         |
| **🕸️ Wiki-Graph**        | D3.js Force-Directed Graph der Verlinkungen          |
| **🎥 YouTube-Import**    | Transkript → automatische Wiki-Seite                 |
| **📥 WeKnora-Migration** | Dokumente, generierte Artikel & Embeddings 1:1 übernehmen |
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
| **Wiki-Editor**  | [TipTap](https://tiptap.dev) (ProseMirror)                                                  |
| **Wiki-Graph**   | [D3.js](https://d3js.org)                                                                   |
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
docker compose up -d db
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
│   │   │   ├── document.ts
│   │   │   ├── chat.ts
│   │   │   ├── wiki.ts
│   │   │   ├── search.ts
│   │   │   └── model.ts
│   │   ├── service/          # Business-Logik
│   │   │   ├── auth.ts
│   │   │   ├── document.ts
│   │   │   ├── embedding.ts
│   │   │   ├── search.ts
│   │   │   ├── wiki.ts
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
│   │       ├── editor/       # TipTap
│   │       └── wiki-graph/   # D3.js
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
├── parser/                   # MarkItDown (Python, optional)
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
docker compose up -d db

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

Kernfunktionen sind implementiert und live: Auth, Workspaces, Dokument-Import (inkl. Parser für PDF/DOCX), hybride Suche, RAG-Chat mit Streaming & Historie, Wiki-Generierung (Summary/Entity/Concept), TipTap-Editor, Wiki-Graph, YouTube-Import und die WeKnora-Migration.

Offen / optional: URL-Scraping-Import, Knowledge-Graph-Pipeline (`graph_enabled`), Web-Suche.

Details & Architektur: [`docs/PLAN.md`](docs/PLAN.md)

---

## 📄 Lizenz

MIT – siehe [LICENSE](./LICENSE).

---

_Inspiriert von [WeKnora](https://github.com/Tencent/WeKnora) (Tencent) – reduziert auf das Wesentliche, erweitert um eine persönliche Vision._
