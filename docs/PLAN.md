# Knora — Konzept & Plan (Revidiert)

> **Projektname**: Knora  
> **Slug**: `knora`  
> **Repository**: [github.com/elmohuppi-stack/knora](https://github.com/elmohuppi-stack/knora)  
> **Sprache**: TypeScript End-to-End

---

## 🎯 Vision

**Knora ist dein persönlicher "Second Brain" – eine AI-native Wissensdatenbank, die Dokumente frisst und ein verlinktes Wiki ausspuckt.**

Stopfe Dokumente, Webseiten, YouTube-Videos und Notizen hinein. Die App versteht sie (Embeddings + Volltext), du kannst Fragen stellen (RAG Chat) – und bekommst ein strukturiertes, verlinktes Wiki geschenkt, das du mit einem TipTap-Editor verfeinern kannst.

Anders als [WeKnora](https://github.com/Tencent/WeKnora) (Enterprise-Knowledge-Base von Tencent) ist Knora **für eine Person** gemacht. Kein Multi-Tenant, keine IM-Integration, keine fünf Vector-DBs. Nur ein scharfes Tool, das funktioniert.

### Use-Cases

- **Wissenssammler**: PDFs, Artikel, YouTube-Videos → Wiki
- **Writer/Researcher**: Recherche zu einem Thema → verlinkte Wiki-Struktur
- **WeKnora-Migrant**: Exportierte Wiki-Seiten verlustfrei importieren und weiterbearbeiten

---

## 🧠 Von WeKnora gelernt

### Übernommen (1:1)

| Konzept                        | Beschreibung                                                                       |
| ------------------------------ | ---------------------------------------------------------------------------------- |
| **Indexing Strategy**          | `vector_enabled`, `keyword_enabled`, `wiki_enabled`, `graph_enabled` pro Workspace |
| **Workspace = Knowledge Base** | Container mit eigener Chunking-/Model-/Indexing-Konfig                             |
| **WikiPage-Modell**            | `slug`, `title`, `content`, `in_links`, `out_links`, `page_type`, `version`        |
| **Hybrid Search**              | pgvector + PostgreSQL tsvector                                                     |
| **Chunk-Typen**                | `text`, `parent_text`, `summary`, `entity`, `faq`, `wiki_page`                     |
| **StreamResponse-Format**      | `response_type`: answer, thinking, error, complete, tool_call                      |
| **YouTube-Import**             | oEmbed + Transcript API → LLM → Wiki-Seite                                         |
| **Prompt-Templates**           | Ausgelagert in YAML/JSON, nicht hartcodiert                                        |

### Verworfen (für Knora)

- ❌ **Multi-Tenant RBAC** – Einzelperson braucht kein Enterprise-Mandantensystem
- ❌ **Multiple Vector DBs** – pgvector reicht völlig
- ❌ **Multiple Storage Backends** – Lokales Filesystem, optional S3 später
- ❌ **Redis Task Queue (Asynq)** – Für Single-User ist inline-processing okay
- ❌ **gRPC DocReader** – Viel zu overengineered
- ❌ **IM Integrationen** (WeCom, Slack, Telegram) – Nicht gewünscht
- ❌ **Chrome Extension / Desktop App / CLI** – Fokus auf Web UI
- ❌ **20+ LLM Provider** – OpenAI-kompatibel + DeepSeek reicht
- ❌ **TDesign UI Library** – Zu stark an Tencents Design gebunden

---

## 🛠️ Tech-Stack – Detaillierte Analyse mit Optionen

### 1. Backend-Runtime

| Technologie | Vorteile                                                                    | Nachteile                                 | **Fazit**                             |
| ----------- | --------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------- |
| **Bun**     | ⚡ 4-5x schneller als Node, natives TS, built-in Testrunner, SSE-freundlich | Noch jung, manche npm-Pakete inkompatibel | **✅ Empfohlen** – bereits im Projekt |
| Node.js     | Riesiges Ökosystem, stabilste Wahl                                          | Langsamer, kein nativer TS                | Alternativ, aber schwächer            |
| Go          | Blitzschnell, single binary, grandiose Concurrency                          | Kein TS, mehr Boilerplate                 | WeKnora nutzt es, für Knora Overkill  |

**🔥 Entscheidung: Bun + Hono** (beibehalten)

### 2. API-Layer

| Technologie           | Vorteile                                                                 | Nachteile                                                        | **Fazit**                                |
| --------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------- | ---------------------------------------- |
| **REST + Hono + Zod** | Einfach, universell, gut testbar, `@hono/zod-validator` gibt Type-Safety | Kein E2E-Type-Safety bis ins Frontend                            | **✅ Empfohlen** – bereits implementiert |
| tRPC                  | Vollständiger E2E-Type-Safety                                            | Erzwungene Kopplung, schwerer debuggbar, nicht im Code umgesetzt | ❌ Gestrichen                            |
| GraphQL               | Flexibles Querying                                                       | Overkill, komplexes Caching                                      | ❌ Nicht nötig                           |

**🔥 Entscheidung: REST + `@hono/zod-validator`** (tRPC gestrichen)

### 3. Frontend-Framework

| Technologie      | Vorteile                                        | Nachteile                             | **Fazit**                             |
| ---------------- | ----------------------------------------------- | ------------------------------------- | ------------------------------------- |
| **Vue 3 + Vite** | Du kennst es, simpel, reaktiv, hervorragende DX | Weniger "batteries included" als Nuxt | **✅ Empfohlen** – bereits im Projekt |
| Nuxt 3           | SSR/SSG, Auto-Imports                           | Overkill für SPA                      | ❌ Nicht nötig                        |
| React + Next.js  | Riesiges Ökosystem                              | JSX, neu lernen                       | ❌ Nicht nötig                        |

**🔥 Entscheidung: Vue 3 + Vite** (beibehalten)

### 4. UI-Library

| Technologie    | Vorteile                                                            | Nachteile                           | **Fazit**                                                |
| -------------- | ------------------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------- |
| **PrimeVue**   | Riesige Komponentenbib (30+), Tree, Splitter, Editor out-of-the-box | "Schwerer", eigenes Design          | **✅ Empfohlen** – weil Tree-Komponente für Wiki-Browser |
| **Shadcn/vue** | Schön, kopierbasiert (keine Dependency), voll anpassbar             | Weniger Komponenten                 | Gute Alternative                                         |
| TDesign        | Sehr umfangreich, von WeKnora erprobt                               | Tencent-Design, gewöhnungsbedürftig | ❌ Nicht empfehlenswert                                  |
| Element Plus   | Stabil, bekannt                                                     | Etwas altbacken                     | Alternativ                                               |

**🔥 Entscheidung: PrimeVue oder Shadcn/vue** (muss installiert werden)

### 5. ORM / DB-Zugriff

| Technologie | Vorteile                                           | Nachteile                            | **Fazit**                                |
| ----------- | -------------------------------------------------- | ------------------------------------ | ---------------------------------------- |
| **Drizzle** | Type-safe, SQL-nah, pgvector-Unterstützung, leicht | Weniger "magic" als Prisma           | **✅ Empfohlen** – bereits implementiert |
| Prisma      | Bekannt, schönes Schema, einfache Migrationen      | Schwergewichtig, generiert viel Code | Alternativ                               |

**🔥 Entscheidung: Drizzle** (beibehalten)

### 6. Datenbank

| Technologie               | Vorteile                                                  | Nachteile                              | **Fazit**                                |
| ------------------------- | --------------------------------------------------------- | -------------------------------------- | ---------------------------------------- |
| **PostgreSQL + pgvector** | Ein Service für Daten + Vektoren, ACID, Backups inklusive | Nur cosine/IP/L2 Distanz               | **✅ Empfohlen** – bereits implementiert |
| SQLite + sqlite-vec       | Embedded, kein Server, unglaublich einfach                | Kein Netzwerkzugriff, weniger Features | Für Embedded-Szenarien                   |
| Qdrant / Milvus           | Spezialisiert auf Vektoren, skalierbar                    | Zusätzlicher Service, Overkill         | ❌ Zu viel Komplexität                   |

**🔥 Entscheidung: PostgreSQL + pgvector** (beibehalten)

### 7. LLM Integration / Streaming

| Technologie              | Vorteile                                                          | Nachteile                                      | **Fazit**                                  |
| ------------------------ | ----------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------ |
| **Vercel AI SDK (`ai`)** | SSE-Streaming OOTB, Tool Calling, Agents, generateText/streamText | Noch relativ neu                               | **✅ Empfohlen** – schließt größte Lücke   |
| Eigener fetch (aktuell)  | Volle Kontrolle                                                   | Kein Streaming, kein Tool Calling, Boilerplate | ❌ Aktueller Zustand – muss ersetzt werden |
| LangChain                | Riesiges Ökosystem                                                | Zu viele Abstraktionen, schwergewichtig        | ❌ Overkill                                |

**🔥 Entscheidung: Vercel AI SDK (`ai`)** (muss eingebaut werden)

### 8. Dokument-Parsing (gestaffelt)

| Phase   | Technologie                                                            | Formate                  |
| ------- | ---------------------------------------------------------------------- | ------------------------ |
| **MVP** | Kein Parser – **Markdown + Plain Text Upload**                         | `.md`, `.txt`            |
| **v1**  | **pdf.js / pdf2md** (JS-nativ, kein separater Service)                 | `.pdf`                   |
| **v2**  | **MarkItDown** (Python-MS, bereits vorhanden) oder **Unstructured.io** | `.docx`, `.html`, Bilder |

**🔥 Entscheidung: MVP nur Text/Markdown – später pdf.js → MarkItDown**

### 9. Task Queue

| Technologie        | Vorteile                           | Nachteile                    | **Fazit**                |
| ------------------ | ---------------------------------- | ---------------------------- | ------------------------ |
| **Keine (inline)** | Nichts zu betreiben, einfach       | Blockiert bei großen Uploads | **✅ Empfohlen für MVP** |
| Bun Worker Threads | Nebenläufig, kein externer Service | Kein Scheduling              | Optional später          |
| Redis + BullMQ     | Bewährt, persistent, Retry         | Redis nötig                  | ❌ Nicht im MVP          |

**🔥 Entscheidung: Keine Queue im MVP** (inline-processing)

### 10. Wiki-Editor

| Technologie              | Vorteile                                                  | Nachteile                          | **Fazit**                                  |
| ------------------------ | --------------------------------------------------------- | ---------------------------------- | ------------------------------------------ |
| **TipTap (ProseMirror)** | Extrem flexibel, custom `[[slug]]`-Nodes, Markdown-Import | Lernkurve für custom Nodes         | **✅ Empfohlen** – bereits in Dependencies |
| CodeMirror / Monaco      | Hervorragend für Markdown                                 | Kein WYSIWYG                       | Alternativ                                 |
| Textarea + Markdown      | Minimal, einfach                                          | Kein WYSIWYG, keine Autocompletion | ❌ Zu primitiv                             |

**🔥 Entscheidung: TipTap** (beibehalten)

### 11. Wiki-Graph

| Technologie                    | Vorteile                                    | Nachteile        | **Fazit**                                  |
| ------------------------------ | ------------------------------------------- | ---------------- | ------------------------------------------ |
| **D3.js Force-Directed Graph** | Extrem flexibel, performant, voll anpassbar | Lernkurve        | **✅ Empfohlen** – bereits in Dependencies |
| Cytoscape.js                   | Speziell für Graphen, einfacher             | Weniger flexibel | Alternative                                |
| Vis.js                         | Sehr einfach                                | Älter            | Alternativ                                 |

**🔥 Entscheidung: D3.js** (beibehalten)

### 12. File Storage

| Technologie            | Vorteile                             | Nachteile                     | **Fazit**                |
| ---------------------- | ------------------------------------ | ----------------------------- | ------------------------ |
| **Lokales Filesystem** | Einfach, schnell, keine Abhängigkeit | Kein Backup, nicht skalierbar | **✅ Empfohlen für MVP** |
| MinIO (S3-kompatibel)  | Skalierbar, selbst gehostet          | Zusätzlicher Service          | Optional später          |

**🔥 Entscheidung: Lokales Filesystem** (beibehalten)

---

## 🏗️ Finale Architektur

```
┌──────────────────────────────────────────────────────────┐
│                     Frontend                              │
│          Vue 3 + Vite + PrimeVue/Shadcn                   │
│  (Chat-UI, Wiki-Browser + Graph, Admin, TipTap Editor)    │
└────────────────────┬─────────────────────────────────────┘
                     │ REST + SSE (EventSource)
                     │ OpenAPI-kompatibel (KEIN tRPC)
┌────────────────────▼─────────────────────────────────────┐
│               Backend API (Bun + Hono)                    │
├──────────────────────────────────────────────────────────┤
│  Auth │ Workspace │ Document │ Wiki │ Chat │ Model        │
│  Hybrid Search │ Embedding │ Vercel AI SDK (Streaming)   │
│  WeKnora-Import │ Admin                                   │
└────────────────────┬─────────────────────────────────────┘
                     │
┌────────────────────▼─────────────────────────────────────┐
│                  Datenbank & Services                     │
├──────────────────────────────────────────────────────────┤
│  PostgreSQL + pgvector (Vektoren + Volltext in einer DB) │
│  Lokales Filesystem (Uploads)                             │
│  [Optional] MarkItDown Parser (Python, per Profile)       │
└──────────────────────────────────────────────────────────┘
```

**Kein Redis. Kein tRPC. Kein separater Vector-Store. Einfach und sauber.**

---

## 📦 WeKnora Export/Import – Strategie

> **Status: umgesetzt.** Realisiert wurde eine **direkte DB→DB-Migration** (nicht der API-Weg), da WeKnora selbst gehostet wird und beide Postgres-DBs auf demselben Host liegen. Skripte: [`weknora-db-import.ts`](../backend/src/scripts/weknora-db-import.ts) (+ [`embed-backfill.ts`](../backend/src/scripts/embed-backfill.ts)). Der API-basierte JSON-Weg unten bleibt als Alternative dokumentiert ([`knora-import.ts`](../backend/src/scripts/knora-import.ts)).
>
> **Embeddings 1:1:** WeKnora und Knora nutzen beide `text-embedding-3-small` (1536 Dim). Dokument-Chunk-Vektoren werden direkt kopiert (`halfvec`→`vector`), nur die generierten Wiki-Artikel werden in Knora neu vektorisiert.

### Hintergrund

Du hast in WeKnora viele Dokumente, Videos und Artikel importiert, woraus Wiki-Seiten generiert wurden. Diese möchtest du exportieren und verlustfrei in Knora importieren, um sie dort weiter zu editieren.

### Datenformat WeKnora → Knora

WeKnora speichert Wiki-Seiten via REST API mit folgender Struktur:

```json
{
  "id": "uuid",
  "knowledge_base_id": "uuid",
  "slug": "entity/weknora-architecture",
  "title": "WeKnora Architecture",
  "summary": "Overview of the WeKnora system architecture...",
  "content": "# WeKnora Architecture\n\nWeKnora is built with... [[Go]] and [[Gin]]...",
  "page_type": "entity",
  "status": "published",
  "out_links": ["go", "gin", "postgresql"],
  "in_links": ["weknora-overview"],
  "aliases": ["WeKnora Arch", "WKA"],
  "source_refs": ["kb_id|weknora_documentation.pdf"],
  "page_metadata": { "tags": ["architecture", "system-design"] },
  "version": 3,
  "created_at": "2025-01-15T10:00:00Z",
  "updated_at": "2025-06-20T14:30:00Z"
}
```

### Kompatibilität – was 1:1 passt

| WeKnora-Feld                | Knora-Feld                                  | Status                            |
| --------------------------- | ------------------------------------------- | --------------------------------- |
| `slug`                      | `wiki_pages.slug`                           | ✅ 1:1                            |
| `title`                     | `wiki_pages.title`                          | ✅ 1:1                            |
| `content` (Markdown)        | `wiki_pages.content`                        | ✅ 1:1 – TipTap rendert Markdown  |
| `summary`                   | `wiki_pages.summary`                        | ✅ 1:1                            |
| `page_type`                 | `wiki_pages.page_type`                      | ⚠️ Wertebereich erweitern (s. u.) |
| `status`                    | `wiki_pages.status`                         | ✅ 1:1                            |
| `out_links`                 | `wiki_pages.out_links`                      | ✅ 1:1                            |
| `in_links`                  | `wiki_pages.in_links`                       | ✅ 1:1                            |
| `version`                   | `wiki_pages.version`                        | ✅ 1:1                            |
| `created_at` / `updated_at` | `wiki_pages.created_at` / `updated_at`      | ✅ 1:1                            |
| `aliases`                   | `wiki_pages.aliases` (JSONB)                | ✅ vorhanden                      |
| `source_refs`               | `wiki_pages.source_refs` (JSONB)            | ✅ vorhanden                      |
| `page_metadata`             | `wiki_pages.page_metadata` (JSONB)          | ✅ vorhanden                      |

### `[[Links]]` – Markdown-Kompatibilität

WeKnora verwendet `[[slug]]`-Syntax für interne Links. **Knora macht das identisch.**  
Der TipTap-Editor kann diese Links parsen, darstellen, anklicken und autocompleten.  
→ **Kein Konflikt, kein Mapping nötig. Importierte Seiten sind sofort editierbar.**

### Erweiterung `page_type`-Wertebereich

```typescript
// Bisher (alt):
type WikiPageType = "article" | "entity" | "concept";

// Neu (erweitert für WeKnora-Kompatibilität):
type WikiPageType =
  | "article"
  | "entity"
  | "concept"
  | "index"
  | "log"
  | "synthesis"
  | "comparison"
  | "youtube_transcript";
```

### Import-Skript: `knora-import.ts`

Ein Skript im Backend (`backend/src/scripts/knora-import.ts`), das:

1. WeKnora-Wiki-Seiten via REST API abholt (oder JSON-Datei einliest)
2. `page_type`-Werte mapped (kompatibel erweitert)
3. `source_refs` und `aliases` in die neuen JSONB-Spalten übernimmt
4. Seiten via Knora-Wiki-API (`POST /api/v1/wiki/import`) importiert
5. `[[Links]]` bleiben erhalten – TipTap rendert sie nativ

**Ergebnis**: Die importierten Wiki-Seiten sehen aus wie in Knora erstellt und sind voll editierbar.

---

## 🗄️ DB-Schema – Änderungen für WeKnora-Kompatibilität

### Neue Migration: `0001_add_weknora_fields`

```sql
-- wiki_pages: neue Spalten für WeKnora-Kompatibilität
ALTER TABLE wiki_pages ADD COLUMN aliases JSONB DEFAULT '[]' NOT NULL;
ALTER TABLE wiki_pages ADD COLUMN source_refs JSONB DEFAULT '[]' NOT NULL;
ALTER TABLE wiki_pages ADD COLUMN page_metadata JSONB DEFAULT '{}' NOT NULL;

-- page_type CHECK-Constraint aktualisieren
-- Bisher: 'article', 'entity', 'concept'
-- Neu: + 'index', 'log', 'synthesis', 'comparison', 'youtube_transcript'
```

### Drizzle Schema (`backend/src/db/schema.ts`) – Ergänzung

```typescript
export const wikiPages = pgTable("wiki_pages", {
  // ... bestehende Felder ...
  aliases: jsonb("aliases").default([]).notNull(), // NEU
  source_refs: jsonb("source_refs").default([]).notNull(), // NEU
  page_metadata: jsonb("page_metadata").default({}).notNull(), // NEU
  // ...
});
```

---

## 🗺️ Status & Roadmap

### ✅ Implementiert (live)

- [x] Auth (Register/Login) – JWT + bcrypt, Rollen Admin/Editor/Viewer
- [x] User-, Model-Provider-, Workspace-CRUD (Admin-Panel)
- [x] Dokument-Import: Upload, URL, YouTube + Parser-Service (PDF/DOCX/HTML)
- [x] Chunking + Embedding-Service (OpenAI-kompatibel, `text-embedding-3-small`)
- [x] Hybrid Search (pgvector + tsvector)
- [x] RAG-Chat mit Quellenangaben, SSE-Streaming (Vercel AI SDK) und Historie-Sidebar
- [x] UI-Library PrimeVue 4 + Navigations-Grundgerüst
- [x] Wiki-Browser (Tabs Summary/Entity/Concept, Suche, Filter)
- [x] TipTap-Editor mit `[[slug]]`-Autocompletion, klickbare `[[Links]]`
- [x] Wiki-Graph (D3.js Force-Directed)
- [x] Wiki-Auto-Generierung: LLM aus Chunks → Summary/Entity/Concept mit Crosslinks (`wiki-generate.ts`, Prompts in `wiki-prompts.ts`)
- [x] JSONB-Felder `aliases`, `source_refs`, `page_metadata`, `chunk_refs` auf `wiki_pages`
- [x] WeKnora-Migration (DB→DB): Dokumente, generierte Artikel, Embeddings 1:1 (`weknora-db-import.ts` + `embed-backfill.ts`)
- [x] Docker Compose + Deploy-Script (Hetzner)

### 🔜 Offen / optional

- [ ] URL-Import: Webseite scrapen → Markdown → Chunks
- [ ] Dokumenten-Preview (PDF, Markdown) in der UI
- [ ] Conversation-Strategy konfigurierbar (thresholds, fallback, rewrite)
- [ ] Web-Suche-Integration
- [ ] Knowledge-Graph-Pipeline (`graph_enabled`)

---

## 🐳 Docker Compose (revidiert – ohne Redis)

```yaml
services:
  app:
    build: ./backend
    ports:
      - "127.0.0.1:${WEB_PORT}:3000"
    env_file: .env
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped
    networks:
      - appnet
      - hetzner-network

  frontend:
    build: ./frontend
    ports:
      - "127.0.0.1:${FRONTEND_PORT}:80"
    restart: unless-stopped
    networks:
      - hetzner-network

  db:
    image: pgvector/pgvector:pg17
    volumes:
      - data:/var/lib/postgresql/data
    env_file: .env
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER:-knora}"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped
    networks:
      appnet:
        aliases:
          - knora-db

  # Parser nur bei Bedarf: docker compose --profile parser up -d
  parser:
    build: ./parser
    profiles: ["parser"]
    env_file: .env
    restart: unless-stopped
    networks:
      - appnet

volumes:
  data:

networks:
  appnet:
  hetzner-network:
    external: true
```

---

## 🔑 Entscheidungen auf einen Blick

| Entscheidung       | Wert                                                      |
| ------------------ | --------------------------------------------------------- |
| **Backend**        | Bun + Hono (✅ bereits implementiert)                     |
| **API**            | REST + `@hono/zod-validator` (❌ tRPC gestrichen)         |
| **Frontend**       | Vue 3 + Vite (✅ bereits implementiert)                   |
| **UI-Library**     | PrimeVue 4 (✅ installiert)                                |
| **State**          | Pinia (✅ bereits implementiert)                          |
| **ORM**            | Drizzle (✅ bereits implementiert)                        |
| **DB**             | PostgreSQL + pgvector (✅ bereits implementiert)          |
| **Redis**          | ❌ Kein Redis im MVP                                      |
| **LLM**            | Vercel AI SDK (✅ eingebaut)                              |
| **Streaming**      | SSE via Vercel AI SDK (✅ implementiert)                  |
| **Parser**         | MVP: Text/Markdown • v1: pdf.js • v2: MarkItDown optional |
| **Task Queue**     | Keine (inline) – später Bun Worker                        |
| **Wiki-Editor**    | TipTap (✅ bereits in Dependencies)                       |
| **Wiki-Graph**     | D3.js (✅ bereits in Dependencies)                        |
| **File Storage**   | Lokales Filesystem (✅ bereits implementiert)             |
| **Shared Types**   | `packages/shared/` (✅ erweitert)                         |
| **Auth**           | JWT + bcrypt (✅ bereits implementiert)                   |
| **WeKnora Import** | DB→DB-Migration inkl. Embeddings (✅ umgesetzt)           |
