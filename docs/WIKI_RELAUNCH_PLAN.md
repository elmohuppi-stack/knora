# Plan: Knora Wiki-Relaunch — Neue Navigation + Wiki-Generierung wie WeKnora

## TL;DR

Zwei große Bausteine:

1. **Neue Navigation** (Option C Hybrid): Sidebar wird auf 3 Einträge reduziert (Chat, Workspaces, Einstellungen). Der Workspace-Selector wandert in die Top-Leiste. Innerhalb eines Workspace gibt es Tabs: **Dokumente** | **Wiki** | **Graph**.
2. **Wiki-Generierung wie WeKnora**: Pro Dokument werden 3 Arten von Wiki-Seiten erstellt – **Summary** (vollständiger Artikel), **Entities** (Personen, Orte, Organisationen), **Concepts** (Themen, Methoden) – mit `[[wiki-link]]`-Crosslinking.

---

## Teil A: Navigation (Option C Hybrid)

### Aktuell (Problem)

```
Sidebar:  Chat  |  Workspaces  |  Wiki  |  Einstellungen
                                         └── redundant (immer workspace-abhängig)
```

Workspace-Detail öffnet eine Detail-Seite mit Buttons, keine Tabs.

### Neu

```
┌──────────────────────────────────────────────┐
│ 🧠 Knora                                      │
│                                                │
│ 💬 Chat                                       │
│ 📚 Workspaces                                 │
│ ⚙️ Einstellungen                              │
│                                                │
├──────────────────────────────────────────────┤
│                                                │
│  📚 Politik                           [Switch ▾]│
│                                                │
│  [📄 Dokumente] [📖 Wiki] [🕸️ Graph]          │
│                                                │
│  ┌──────────┬─────────────────────────────┐    │
│  │ Suche    │ Inhalt (Reader / Liste)     │    │
│  │ Summaries│                             │    │
│  │ Entities │                             │    │
│  │ Concepts │                             │    │
│  └──────────┴─────────────────────────────┘    │
│                                                │
└──────────────────────────────────────────────┘
```

### Routen

| Route                              | Inhalt                                            |
| ---------------------------------- | ------------------------------------------------- |
| `/chat`                            | Chat (workspace-übergreifend)                     |
| `/workspaces`                      | Workspace-Liste                                   |
| `/workspaces/:id`                  | **Hub** – redirect zu `/workspaces/:id/documents` |
| `/workspaces/:id/documents`        | Dokumente-Tab (YouTube, PDFs, URLs)               |
| `/workspaces/:id/documents/:docId` | Einzelnes Dokument (Transkript, Metadaten)        |
| `/workspaces/:id/wiki`             | Wiki-Tab (Sidebar + Reader)                       |
| `/workspaces/:id/wiki/:slug`       | Einzelne Wiki-Seite                               |
| `/workspaces/:id/graph`            | Graph-Tab                                         |
| `/settings`                        | Einstellungen                                     |

### Sidebar-Logik

- "Workspaces" klicken → springt zum **zuletzt aktiven** Workspace → dessen Dokumente-Tab
- Kleiner Pfeil neben dem Workspace-Namen → Dropdown zum Umschalten (alle Workspaces)
- Workspace-Liste (`/workspaces`) bleibt erreichbar, aber primärer Einstieg ist der Direktsprung

---

## Teil B: Wiki-Generierung (WeKnora-Prinzip)

### Datenmodell (wiki_pages Tabelle)

Besteht bereits weitgehend, braucht nur `chunk_refs`:

```diff
+ chunk_refs: jsonb, default []
```

`workspaces.wiki_config` bekommt `extraction_granularity`:

```diff
+ extraction_granularity: "standard" | "focused" | "exhaustive"
```

### Pipeline (vereinfacht, kein asynq/Redis)

```
Dokument-Upload
  │
  ├─→ Chunking + Embedding (besteht schon)
  │
  └─→ Wiki-Generierung (neu)
       │
       ├─ Pass 0: extractCandidates()
       │   LLM scannt Dokument → JSON mit Entities + Concepts
       │
       ├─ Summary generieren
       │   LLM schreibt vollständigen Artikel mit [[slug|name]]-Links
       │
       ├─ Reduce: Entities/Concepts anlegen oder updaten
       │   Deduplizierung → WikiPageModifyPrompt
       │
       ├─ Cross-Links injizieren
       │   Automatisch [[links]] in bestehenden Seiten
       │
       └─ Index-Intro aktualisieren
```

### LLM-Prompts (in `backend/src/service/wiki-prompts.ts`)

1. **WikiCandidateSlugPrompt** – Entities+Concepts als JSON extrahieren
2. **WikiSummaryPrompt** – Vollständigen Wiki-Artikel mit Links generieren
3. **WikiPageModifyPrompt** – Entity/Concept-Seite mergen/aktualisieren
4. **WikiDeduplicationPrompt** – Duplikate erkennen
5. **WikiIndexIntroPrompt** – Index-Seiten-Intro generieren

Alle Prompts auf Deutsch (language = "de" fest, später parametrisierbar).

---

## Phasen & Steps

### Phase 1: Navigation & Routing (Frontend)

_Keine Abhängigkeit von Phase 2_

1. **Sidebar umbauen** (`App.vue`):
   - "Wiki" Eintrag entfernen
   - "Workspaces" behalten (springt zum zuletzt aktiven Workspace)
2. **Router neu strukturieren** (`router/index.ts`):
   - `/workspaces/:id` wird zum Hub mit Sub-Routen
   - `/workspaces/:id/documents` – Dokumente-Tab
   - `/workspaces/:id/wiki` – Wiki-Tab
   - `/workspaces/:id/graph` – Graph-Tab
   - `/wiki/...` Routen entfernen (durch `/workspaces/.../wiki/...` ersetzt)
3. **Workspace-Detail** (`WorkspaceDetail.vue`) ersetzen durch neuen Workspace-Hub:
   - Workspace-Selector (Dropdown in Top-Leiste)
   - Tab-Leiste: Dokumente | Wiki | Graph
   - Workspace-Name + Switch in der Header-Zeile
4. **CSS/Layout anpassen**: Tabs + Sidebar-Struktur

### Phase 2: Backend – DB & API

_Unabhängig von Phase 1_

5. **DB Schema erweitern** (`schema.ts`):
   - `wiki_pages.chunk_refs` hinzufügen (jsonb, default [])
   - `workspaces.wiki_config.extraction_granularity` hinzufügen
   - Drizzle-Migration generieren
6. **Neue Wiki-API-Endpunkte** (`router/wiki.ts`):
   - `GET /workspaces/:id/wiki/index` – Strukturierte Index-Ansicht
   - `GET /workspaces/:id/wiki/stats` – Statistiken
   - `GET /workspaces/:id/wiki/pages?type=summary|entity|concept` – Paginierte Liste pro Typ
7. **Dokumente-API bereinigen** (`router/document.ts`):
   - `/documents/:workspaceId` bleibt, Routen ggf. anpassen

### Phase 3: Wiki-Generierung (Backend – Kern)

_Abh. von Phase 2 (DB Schema)_

8. **LLM-Prompts definieren** (`service/wiki-prompts.ts`):
   - Alle 5 Prompts aus WeKnora übersetzen (Deutsch)
   - Template-Variablen: `{{.Content}}`, `{{.ExtractedSlugs}}`, `{{.ExistingContent}}`, etc.
9. **Wiki-Pipeline bauen** (`service/wiki-generate.ts`):
   - `generateWikiArticles(docId, workspaceId)`: Hauptfunktion
   - `extractCandidates()`: Pass 0 – LLM-Call für Entities+Concepts
   - `generateSummary()`: Summary-Artikel mit Links
   - `reduceEntitiesConcepts()`: Entity/Concept-Seiten anlegen/updaten
   - `injectCrossLinks()`: Automatische Links in bestehenden Seiten
   - `updateIndexIntro()`: Index aktualisieren
10. **Bestehende `generateWikiPage()` ersetzen** in `wiki.ts`:
    - Trigger in `document.ts` (`scheduleWikiGeneration`) auf neue Pipeline umstellen

### Phase 4: Wiki-Frontend

_Abh. von Phase 1 (Navigation) + Phase 3 (Prompts+API)_

11. **WikiBrowser.vue komplett überarbeiten**:
    - Sidebar: Suchfeld + Tab-Bar (Summaries | Entities | Concepts)
    - Paginierte Liste pro Tab mit Typ-Counts (wie WeKnora)
    - Rechte Seite: Reader mit Markdown-Rendering
12. **WikiPage.vue erweitern**:
    - `[[slug|text]]` → klickbare Router-Links rendern
    - Backlinks anzeigen (verlinkt von)
    - Typ-Tag + Aliase anzeigen
    - Sidebar-Navigation fixieren (aktuelle Position merken)
13. **DocumentDetail.vue anpassen**:
    - "Wiki-Artikel" Tab durch Link zum Wiki ersetzen
    - Klare Trennung: Dokumente-Tab = Rohmaterial

### Phase 5: Integration & Daten-Migration

_Abh. von Phase 3 + 4_

14. **Import-Script verbessern** (`scripts/knora-import.ts`):
    - WeKnora-KB → Workspace Mapping
    - Alle 4 Workspaces aus WeKnora importieren
    - Entities/Concepts + Links sauber übernehmen
15. **WeKnora-Import testen**: Politik + Corona + RKI Files + Example Archive
16. **End-to-End Test**: YouTube importieren → Wiki-Artikel + Entities + Concepts erscheinen

---

## Abhängigkeitsgraph

```
Phase 1 (Navigation) ──┐
                        ├──→ Phase 4 (Wiki-Frontend)
Phase 2 (DB+API) ──────┤
                        │
Phase 3 (Wiki-Gen) ────┘
                        │
Phase 5 (Integration) ←─┘
```

Phase 1 und Phase 2 können **parallel** gestartet werden. Phase 3 baut auf Phase 2 auf. Phase 4 baut auf Phase 1 + 3 auf.

---

## Relevante Dateien

### WeKnora (Referenz)

- `WeKnora/internal/agent/prompts_wiki.go` – Alle LLM-Prompts
- `WeKnora/internal/application/service/wiki_ingest.go` – Hauptpipeline
- `WeKnora/internal/application/service/wiki_linkify.go` – Cross-Link Injection
- `WeKnora/internal/types/wiki_page.go` – Datenmodell

### Knora – zu modifizieren

| Phase | Datei                                              | Änderung                                   |
| ----- | -------------------------------------------------- | ------------------------------------------ |
| 1     | `frontend/src/App.vue`                             | Sidebar: Wiki entfernen, Workspaces-Logik  |
| 1     | `frontend/src/router/index.ts`                     | Routen auf `/workspaces/:id/...` umstellen |
| 1     | `frontend/src/views/workspace/WorkspaceDetail.vue` | Durch Hub mit Tabs ersetzen                |
| 1     | `frontend/src/views/documents/DocumentList.vue`    | Pfad-Anpassung                             |
| 1     | `frontend/src/views/documents/DocumentDetail.vue`  | Pfad-Anpassung                             |
| 2     | `backend/src/db/schema.ts`                         | `chunk_refs`, `extraction_granularity`     |
| 2     | `backend/src/router/wiki.ts`                       | Neue Endpunkte (index, stats, pages)       |
| 3     | `backend/src/service/wiki-prompts.ts`              | **NEU** – Alle LLM-Prompts                 |
| 3     | `backend/src/service/wiki-generate.ts`             | **NEU** – Pipeline                         |
| 3     | `backend/src/service/wiki.ts`                      | Bestehende Funktionen erweitern            |
| 3     | `backend/src/router/document.ts`                   | Trigger auf neue Pipeline                  |
| 4     | `frontend/src/views/wiki/WikiBrowser.vue`          | Komplett überarbeiten (Tabs, Sidebar)      |
| 4     | `frontend/src/views/wiki/WikiPage.vue`             | Wiki-Links rendern, Typ-Tag, Aliase        |
| 5     | `backend/src/scripts/knora-import.ts`              | WeKnora-Import verbessern                  |

---

## Teil C: Chat + Wiki Integration

### Aktuelles Problem

Der Chat (`chat.ts`) sucht aktuell **nur in der `chunks`-Tabelle**, die aus `documents` befüllt wird. Wiki-Seiten (`wiki_pages`) werden **nicht in Chunks gesynct** und sind daher **nicht über RAG auffindbar**.

Eine Chat-Frage zu einem Thema, das nur als Wiki-Artikel existiert (z.B. "Was ist der ÖGD?"), würde **keine relevanten Chunks** finden.

### Lösung

**Wiki-Pages in Chunks syncen** – analog zu WeKnora:

1. Beim **Erstellen/Aktualisieren** einer Wiki-Seite → Inhalt wird gechunkt und in `chunks` gespeichert (mit `document_id` = `wiki--<page-id>`)
2. Beim **Löschen** einer Wiki-Seite → Zugehörige Chunks werden entfernt
3. Die **Suche** (`search.ts`) bleibt unverändert – sie durchsucht bereits `chunks`, jetzt inkl. Wiki-Chunks

```typescript
// In wiki.ts / wiki-generate.ts
export async function syncWikiPageToChunks(
  workspaceId: string,
  pageId: string,
  content: string,
) {
  // 1. Alte Chunks für diese Wiki-Seite löschen
  await db
    .delete(chunks)
    .where(
      and(
        eq(chunks.document_id, `wiki--${pageId}`),
        eq(chunks.workspace_id, workspaceId),
      ),
    );

  // 2. Neuen Content chucken + speichern
  const chunkList = splitIntoChunks(content, chunkSize, chunkOverlap);
  await saveChunks(`wiki--${pageId}`, workspaceId, chunkList);
}
```

Die `chunk_size`/`chunk_overlap` werden aus dem Workspace geladen. Wiki-Chunks bekommen `document_id = wiki--<page-id>`, damit sie eindeutig als Wiki-Chunks identifizierbar sind.

**Im Chat-Response** können Wiki-Seiten dann als Quellen angezeigt werden (analog zu Dokumenten-Quellen).

---

## Teil D: WeKnora Daten-Import (Migration)

### Datenstruktur in WeKnora

WeKnora hat 3 relevante Entitäten für den Import:

| WeKnora                 | Knora          | Mapping                                 |
| ----------------------- | -------------- | --------------------------------------- |
| `knowledge_base`        | `workspaces`   | 1:1 (Name, Beschreibung)                |
| `knowledge` (Dokumente) | `documents`    | 1:1 (Title, Type, Content, etc.)        |
| `wiki_pages`            | `wiki_pages`   | 1:1 (Slug, Title, Content, Links, etc.) |
| `knowledge_base.id`     | `workspace.id` | Wird beibehalten (UUID)                 |

### Import-Strategie: API-basiert (empfohlen)

Statt direkt auf die WeKnora-DB zuzugreifen (die auf einem Server läuft), exportieren wir Daten **über die REST API** von WeKnora:

**Schritt 1: Knowledge Bases (Workspaces) exportieren**

```
GET /api/knowledge_bases
→ Liste aller KBs (Politik, Corona, RKI Files, Example Archive)
```

**Schritt 2: Knowledge Items (Dokumente) pro KB exportieren**

```
GET /api/knowledge_bases/:kbId/knowledge?page_size=1000
→ Alle YouTube-Videos, PDFs, URLs pro KB
```

Jedes Knowledge hat: `id`, `title`, `type` (youtube, manual, url), `source` (URL), `file_type`, `parse_status`, `created_at`

**Schritt 3: Wiki Pages pro KB exportieren**

```
GET /api/knowledge_bases/:kbId/wiki/pages?page_size=5000
→ Alle Summary-, Entity-, Concept-Seiten pro KB
```

Jede Page hat: `slug`, `title`, `page_type`, `content`, `summary`, `out_links`, `in_links`, `aliases`, `source_refs`, `version`

**Schritt 4: Chunks pro Dokument exportieren**

```
GET /api/knowledge/:knowledgeId/chunks
→ Text-Chunks mit Embeddings (für Chat-Funktionalität)
```

### Python-Export-Script (`scripts/weknora-export.py`)

Ein Python-Skript, das:

1. API-Key aus Umgebungsvariable liest (`WEKNORA_API_KEY`)
2. Alle KBs iteriert
3. Pro KB: Knowledge + Wiki Pages + Chunks abruft
4. In **JSON-Dateien** speichert (eine pro KB):

```
exports/
  politik/
    workspace.json           # KB-Metadaten
    documents.json           # Alle Knowledge-Items
    wiki-pages.json          # Alle Wiki-Seiten
    chunks.json              # Alle Chunks (für Chat-Suche)
  corona/
    workspace.json
    documents.json
    wiki-pages.json
    chunks.json
  rki-files/
    ...
  example-archive/
    ...
```

### Import-Pipeline (`scripts/knora-import.ts` – erweitert)

Der bestehende Import wird erweitert:

1. **Workspace anlegen** (falls nicht vorhanden) aus `workspace.json`
2. **Dokumente importieren** aus `documents.json`:
   - YouTube-Dokumente → `type: "youtube"`, `source_url` wird gesetzt
   - Manuelle/URL-Dokumente → `type: entsprechend`
   - Content aus WeKnora übernehmen (Transkript)
3. **Wiki-Seiten importieren** aus `wiki-pages.json`:
   - Verwendet bereits existierende `importWeKnoraPages()` Funktion
   - `page_type` wird gemappt (entity, concept, summary, index, etc.)
   - `source_refs` verknüpfen Wiki-Seiten mit importierten Dokumenten
4. **Chunks importieren** aus `chunks.json`:
   - Dokument-Chunks: `document_id` bleibt erhalten
   - Wiki-Chunks: `document_id = wiki--<page-id>`
   - Embeddings werden übernommen (gleiches Modell: text-embedding-3-small)
5. **Links validieren**: `resolveLinks()` filtert nicht-existierende Slugs

### Mögliche Probleme & Lösungen

| Problem                                | Lösung                                                               |
| -------------------------------------- | -------------------------------------------------------------------- |
| Unterschiedliche User-IDs              | WeKnora hat eigene User – wir setzen `created_by` auf den Admin-User |
| Unterschiedliche ID-Formate            | Beide Systeme nutzen UUIDs – IDs können beibehalten werden           |
| Chunk-Embeddings (1536d)               | Können direkt übernommen werden (gleiches Modell)                    |
| Wiki-Links zu nicht importierten Pages | `resolveLinks()` filtert nicht-existierende Slugs automatisch        |
| Sehr große KBs (>10.000 Pages)         | Paginierung im Export-Script beachten                                |

### Vereinfachter Schnell-Import (MVP)

Für den **ersten Test** reicht:

1. WeKnora-Admin-UI: Manuell Pages + Documents via Browser-DevTools als JSON exportieren
2. Oder: Direktes DB-Script, wenn WeKnora lokal läuft
3. In Knora importieren: `bun run src/scripts/knora-import.ts <workspace-id> <json-file>`

Der **API-basierte Export** (Python-Script) kommt in Phase 5 als automatisierte Lösung.

---

## Aktualisierte Phasen

### Phase 1: Navigation & Routing (Frontend)

_Keine Abhängigkeit von Phase 2_

1. **Sidebar umbauen** (`App.vue`):
   - "Wiki" Eintrag entfernen
   - "Workspaces" behalten (springt zum zuletzt aktiven Workspace)
2. **Router neu strukturieren** (`router/index.ts`):
   - `/workspaces/:id` wird zum Hub mit Sub-Routen
   - `/workspaces/:id/documents` – Dokumente-Tab
   - `/workspaces/:id/wiki` – Wiki-Tab
   - `/workspaces/:id/graph` – Graph-Tab
   - `/wiki/...` Routen entfernen (durch `/workspaces/.../wiki/...` ersetzt)
3. **Workspace-Detail** (`WorkspaceDetail.vue`) ersetzen durch neuen Workspace-Hub:
   - Workspace-Selector (Dropdown in Top-Leiste)
   - Tab-Leiste: Dokumente | Wiki | Graph
   - Workspace-Name + Switch in der Header-Zeile
4. **CSS/Layout anpassen**: Tabs + Sidebar-Struktur

### Phase 2: Backend – DB & API

_Unabhängig von Phase 1_

5. **DB Schema erweitern** (`schema.ts`):
   - `wiki_pages.chunk_refs` hinzufügen (jsonb, default [])
   - `workspaces.wiki_config.extraction_granularity` hinzufügen
   - Drizzle-Migration generieren
6. **Neue Wiki-API-Endpunkte** (`router/wiki.ts`):
   - `GET /workspaces/:id/wiki/index` – Strukturierte Index-Ansicht
   - `GET /workspaces/:id/wiki/stats` – Statistiken
   - `GET /workspaces/:id/wiki/pages?type=summary|entity|concept` – Paginierte Liste pro Typ
7. **Wiki-Chunk-Sync** (`service/wiki.ts`):
   - `syncWikiPageToChunks()` – Wiki-Content in chunks-Tabelle syncen
   - Wird beim Create/Update/Delete einer Wiki-Page aufgerufen

### Phase 3: Wiki-Generierung (Backend – Kern)

_Abh. von Phase 2 (DB Schema)_

8. **LLM-Prompts definieren** (`service/wiki-prompts.ts`):
   - Alle 5 Prompts aus WeKnora übersetzen (Deutsch)
   - Template-Variablen: `{{.Content}}`, `{{.ExtractedSlugs}}`, `{{.ExistingContent}}`, etc.
9. **Wiki-Pipeline bauen** (`service/wiki-generate.ts`):
   - `generateWikiArticles(docId, workspaceId)`: Hauptfunktion
   - `extractCandidates()`: Pass 0 – LLM-Call für Entities+Concepts
   - `generateSummary()`: Summary-Artikel mit Links
   - `reduceEntitiesConcepts()`: Entity/Concept-Seiten anlegen/updaten
   - `injectCrossLinks()`: Automatische Links in bestehenden Seiten
   - `updateIndexIntro()`: Index aktualisieren
10. **Bestehende `generateWikiPage()` ersetzen** in `wiki.ts`:
    - Trigger in `document.ts` (`scheduleWikiGeneration`) auf neue Pipeline umstellen

### Phase 4: Wiki-Frontend

_Abh. von Phase 1 (Navigation) + Phase 3 (Prompts+API)_

11. **WikiBrowser.vue komplett überarbeiten**:
    - Sidebar: Suchfeld + Tab-Bar (Summaries | Entities | Concepts)
    - Paginierte Liste pro Tab mit Typ-Counts (wie WeKnora)
    - Rechte Seite: Reader mit Markdown-Rendering
12. **WikiPage.vue erweitern**:
    - `[[slug|text]]` → klickbare Router-Links rendern
    - Backlinks anzeigen (verlinkt von)
    - Typ-Tag + Aliase anzeigen
    - Sidebar-Navigation fixieren (aktuelle Position merken)
13. **DocumentDetail.vue anpassen**:
    - "Wiki-Artikel" Tab durch Link zum Wiki ersetzen
    - Klare Trennung: Dokumente-Tab = Rohmaterial

### Phase 5: WeKnora Import & Integration

_Größtenteils unabhängig – kann parallel zu Phase 3+4 starten_

14. **Export-Script bauen** (`scripts/weknora-export.py`):
    - Python-Script, das WeKnora-API abfragt
    - Exportiert KBs + Documents + Wiki-Pages + Chunks als JSON
    - Baut Verzeichnisstruktur pro KB auf
15. **Import-Script erweitern** (`scripts/knora-import.ts`):
    - Workspace aus `workspace.json` anlegen
    - Dokumente aus `documents.json` importieren
    - Wiki-Seiten aus `wiki-pages.json` importieren (besteht bereits teilweise)
    - Chunks aus `chunks.json` importieren (mit Embeddings)
    - Bidirektionale Links validieren
16. **End-to-End Test**: Kompletter Import aller 4 WeKnora-Workspaces
17. **Chat-Test**: Fragen zu importierten Wiki-Inhalten stellen → RAG findet Wiki-Chunks

---

## Verifikation

1. **Navigation**: Sidebar zeigt nur Chat, Workspaces, Einstellungen
2. **Workspace-Hub**: Workspace öffnen → Tabs (Dokumente, Wiki, Graph) sind sichtbar
3. **Workspace-Switch**: Dropdown in Top-Leiste wechselt zwischen Workspaces
4. **Dokumente-Tab**: Zeigt nur Rohmaterial (YouTube, PDFs), keine Wiki-Artikel
5. **Wiki-Tab**: Sidebar mit Summaries/Entities/Concepts Tabs + Counts
6. **Wiki-Artikel**: Enthält `[[entity/...|Name]]` Links, die klickbar sind
7. **Entity-Seite**: Existiert als eigenständige Wiki-Seite mit Inhalt + Backlinks
8. **Chat + Wiki**: Chat-Antworten referenzieren Wiki-Seiten als Quellen
9. **Import**: Alle 4 WeKnora-Workspaces werden korrekt importiert inkl. Dokumente + Wiki + Chunks

---

## Entscheidungen

| Thema                  | Entscheidung                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Navigation**         | Option C Hybrid: Sidebar (Chat, Workspaces, Settings) + Workspace-Selector in Top-Leiste + Tabs (Dokumente, Wiki, Graph) |
| **Pipeline**           | Vereinfacht (kein asynq/Redis): setTimeout + einfacher Lock                                                              |
| **Page-Typen**         | Phase 1: summary, entity, concept. synthesis/comparison später                                                           |
| **Granularität**       | Default "standard", via `wiki_config.extraction_granularity`                                                             |
| **Sprache**            | Deutsch (fest), später parametrisierbar                                                                                  |
| **Prompts**            | Template-Strings in `wiki-prompts.ts`                                                                                    |
| **Wiki-Chunk-Sync**    | Wiki-Pages werden in `chunks`-Tabelle gesynct (`document_id = wiki--<page-id>`)                                          |
| **Chat-Suche**         | Sucht in `chunks` – inkludiert Wiki-Chunks automatisch nach Sync                                                         |
| **Import-Strategie**   | API-basiert: Python-Export-Script ruft WeKnora-REST-API ab, speichert als JSON                                           |
| **Import-Reihenfolge** | 1. Workspace → 2. Documents → 3. Wiki-Pages → 4. Chunks                                                                  |
| **Phase 1+2**          | Können parallel umgesetzt werden                                                                                         |
| **Phase 5 (Import)**   | Kann parallel zu Phase 3+4 starten (Export-Script ist unabhängig)                                                        |

---

## Teil E: Deployment auf Hetzner

### Aktuelle Infrastruktur

Knora läuft bereits auf Hetzner unter:

| Subdomain                | Port             | Container          |
| ------------------------ | ---------------- | ------------------ |
| `knora.elmarhepp.de`     | Frontend: `3084` | Nginx (Frontend)   |
| `knora-api.elmarhepp.de` | API: `3000`      | Backend (Bun/Hono) |

**Aktuelle Services:**

- **app** (Backend): Bun/Hono API auf Port 3000
- **frontend** (Nginx): Vite-Build auf Port 3084
- **db** (PostgreSQL): pgvector/pgvector:pg17
- **parser** (optional): Python-Dokumentenparser auf Port 8001

**Status:** Läuft bereits stabil. Der Relaunch ändert an der Deployment-Architektur nichts Grundlegendes.

### Nginx-Konfiguration (besteht bereits)

```nginx
# /etc/nginx/sites-available/knora.conf
# Frontend
server {
    server_name knora.elmarhepp.de;
    listen 443 ssl;
    # SSL config ...
    location / {
        proxy_pass http://127.0.0.1:3084;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# API
server {
    server_name knora-api.elmarhepp.de;
    listen 443 ssl;
    # SSL config ...
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Was sich durch den Relaunch ändert

**Nichts an der Infrastruktur.** Es werden keine neuen Subdomains, Ports oder Services benötigt:

| Aspekt             | Änderung                                                |
| ------------------ | ------------------------------------------------------- |
| **Subdomains**     | Bleiben `knora.elmarhepp.de` + `knora-api.elmarhepp.de` |
| **Ports**          | Frontend `3084`, API `3000` – unverändert               |
| **Docker-Compose** | Keine neuen Services (Wiki lebt im Backend)             |
| **Nginx**          | Keine Änderung                                          |
| **Deploy-Script**  | `deploy.sh` bleibt identisch                            |
| **CI/CD**          | `rsync + docker compose up -d --build` bleibt           |

### Migration nach dem Relaunch

Sobald der Code fertig ist:

```bash
# 1. Lokal bauen und auf Server deployen
./deploy.sh root@<hetzner-server>

# 2. DB-Migration ausführen (neue Spalten chunk_refs, extraction_granularity)
ssh root@<hetzner-server>
cd /var/www/knora
docker compose exec app bun run src/db/migrate.ts

# 3. WeKnora-Daten importieren (nach Export)
docker compose exec app bun run src/scripts/knora-import.ts <workspace-id> ./exports/politik/wiki-pages.json

# 4. Prüfen
#    - https://knora.elmarhepp.de → Navigation ohne Wiki-Top-Level
#    - Workspace "Politik" → Tabs: Dokumente, Wiki, Graph
#    - API: https://knora-api.elmarhepp.de/api/v1/health
```

### Erweiterung für 4+ Workspaces

Keine Deployment-Änderung nötig – Workspaces sind reine Datenbankeinträge. Einzige Überlegung:

- **Speicher**: 4 Workspaces mit Chunks + Embeddings brauchen mehr DB-Speicher. Aktuell pgvector mit 1536d Embeddings. Bei RKI Files (194 Dokumente) ca. 200-400 MB.
- **Parser**: Falls PDFs aus RKI Files importiert werden, muss der Parser-Service laufen (`docker compose --profile parser up -d`).

### Rollback-Plan

Falls der Relaunch Probleme macht:

```bash
# Git-Status prüfen
git log --oneline -5

# Alten Stand deployen
git checkout <vorheriger-tag>
./deploy.sh root@<hetzner-server>
```

Die Router-Änderungen sind abwärtskompatibel (alte `/wiki/...` und `/documents/...` Pfade leiten per Redirect auf die neuen `/workspaces/...` Pfade um).
