<template>
  <main class="wiki-main">
    <div class="wiki-header">
      <h3>📖 Wiki</h3>
      <select v-model="workspaceId" @change="loadPages" class="ws-select">
        <option value="">— Workspace wählen —</option>
        <option v-for="ws in workspaces" :key="ws.id" :value="ws.id">
          {{ ws.name }}
        </option>
      </select>
      <div class="header-actions" v-if="workspaceId">
        <button class="btn-primary" @click="showCreate = true">
          + Neue Seite
        </button>
        <button class="btn-secondary" @click="showImport = true">
          📥 Import
        </button>
      </div>
    </div>

    <template v-if="workspaceId">
      <div class="wiki-toolbar">
        <input
          v-model="searchQuery"
          @input="loadPages"
          placeholder="Wiki durchsuchen..."
          class="search-input"
        />
        <span class="page-count">{{ totalPages }} Seiten</span>
      </div>
      <div class="wiki-content">
        <div v-if="loading" class="status-text">Lade...</div>
        <div v-else-if="pages.length === 0" class="status-text">
          <p>
            Noch keine Wiki-Seiten. Generiere Seiten aus Dokumenten oder
            erstelle sie manuell.
          </p>
        </div>
        <div v-else class="page-list">
          <div
            v-for="p in pages"
            :key="p.id"
            class="page-card"
            @click="
              $router.push(`/wiki/${workspaceId}/${encodeURIComponent(p.slug)}`)
            "
          >
            <div class="page-type-badge">{{ typeIcon(p.page_type) }}</div>
            <div class="page-info">
              <h4>{{ p.title }}</h4>
              <p class="page-summary">
                {{ p.summary || "Keine Zusammenfassung" }}
              </p>
              <div class="page-meta">
                <span>{{ p.page_type }}</span>
                <span>{{ formatDate(p.updated_at) }}</span>
                <span v-if="p.out_links?.length"
                  >{{ p.out_links.length }} →</span
                >
                <span v-if="p.in_links?.length">{{ p.in_links.length }} ←</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
    <div v-else class="wiki-empty">
      <p>Wähle einen Workspace aus, um dessen Wiki zu durchsuchen.</p>
    </div>

    <div
      v-if="showCreate"
      class="dialog-overlay"
      @click.self="showCreate = false"
    >
      <div class="dialog">
        <h3>Neue Wiki-Seite</h3>
        <div class="field">
          <label>Titel *</label
          ><input
            v-model="form.title"
            placeholder="Titel"
            @input="generateSlug"
          />
        </div>
        <div class="field">
          <label>Slug *</label
          ><input v-model="form.slug" placeholder="wiki/mein-artikel" />
        </div>
        <div class="field">
          <label>Typ</label>
          <select v-model="form.page_type">
            <option value="article">Artikel</option>
            <option value="entity">Entität</option>
            <option value="concept">Konzept</option>
          </select>
        </div>
        <div class="dialog-actions">
          <button class="btn-secondary" @click="showCreate = false">
            Abbrechen
          </button>
          <button
            class="btn-primary"
            @click="createPage"
            :disabled="!form.title || !form.slug"
          >
            Erstellen
          </button>
        </div>
        <p v-if="createError" class="error">{{ createError }}</p>
      </div>
    </div>

    <!-- WeKnora Import Dialog -->
    <div
      v-if="showImport"
      class="dialog-overlay"
      @click.self="showImport = false"
    >
      <div class="dialog dialog-wide">
        <h3>📥 WeKnora Import</h3>
        <p class="dialog-hint">
          Importiere Wiki-Seiten aus einem WeKnora-JSON-Export. Die Seiten
          werden mit <code>[[slug]]</code>-Links in das Wiki eingefügt.
        </p>

        <div class="field">
          <label>JSON-Datei hochladen</label>
          <input
            type="file"
            ref="fileInput"
            @change="onFileSelected"
            accept=".json"
            class="file-input"
          />
        </div>

        <div class="field">
          <label>Oder JSON direkt einfügen</label>
          <textarea
            v-model="importJson"
            @input="parseImportJson"
            rows="8"
            placeholder='[{ "slug": "...", "title": "...", "content": "..." }]'
            class="import-textarea"
          ></textarea>
        </div>

        <div v-if="importPreview" class="import-preview">
          <p>
            📊 {{ importPreview.length }} Seiten gefunden:
            <span v-for="(count, type) in importTypeCounts" :key="type">
              {{ type }}: {{ count }}
            </span>
          </p>
        </div>

        <div v-if="importResult" class="import-result">
          <p class="success">✅ {{ importResult.imported }} importiert</p>
          <p v-if="importResult.skipped" class="warning">
            ⏭️ {{ importResult.skipped }} übersprungen
          </p>
          <div v-if="importResult.errors" class="import-errors">
            <p
              v-for="(err, i) in importResult.errors.slice(0, 5)"
              :key="i"
              class="error"
            >
              {{ err }}
            </p>
            <p v-if="importResult.errors.length > 5">
              ... und {{ importResult.errors.length - 5 }} weitere
            </p>
          </div>
        </div>

        <div class="dialog-actions">
          <button class="btn-secondary" @click="closeImport">Schließen</button>
          <button
            class="btn-primary"
            @click="startImport"
            :disabled="!importParsed || importing"
          >
            {{ importing ? "⏳ Importiere..." : "📥 Import starten" }}
          </button>
        </div>
        <p v-if="importError" class="error">{{ importError }}</p>
      </div>
    </div>
  </main>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../../stores/auth";
import axios from "axios";

const auth = useAuthStore();
const router = useRouter();
const workspaces = ref<any[]>([]);
const workspaceId = ref("");
const pages = ref<any[]>([]);
const totalPages = ref(0);
const loading = ref(false);
const searchQuery = ref("");
const showCreate = ref(false);
const createError = ref("");
const form = ref({ title: "", slug: "", page_type: "article" });

// Import
const showImport = ref(false);
const importJson = ref("");
const importing = ref(false);
const importError = ref("");
const importResult = ref<any>(null);
const importParsed = ref<any[] | null>(null);
const importPreview = ref<any[] | null>(null);
const importTypeCounts = ref<Record<string, number>>({});
const fileInput = ref<HTMLInputElement>();

onMounted(async () => {
  if (!auth.isAuthenticated) {
    router.push("/login");
    return;
  }
  await loadWorkspaces();
});

async function loadWorkspaces() {
  try {
    const res = await axios.get("/api/v1/workspaces");
    workspaces.value = res.data.workspaces || [];
  } catch {}
}

async function loadPages() {
  if (!workspaceId.value) return;
  loading.value = true;
  try {
    const params: any = {};
    if (searchQuery.value) params.query = searchQuery.value;
    const res = await axios.get(`/api/v1/wiki/${workspaceId.value}/pages`, {
      params,
    });
    pages.value = res.data.pages || [];
    totalPages.value = res.data.total || 0;
  } catch (e: any) {
    console.error("Failed to load pages", e);
  } finally {
    loading.value = false;
  }
}

function generateSlug() {
  if (form.value.title && !form.value.slug.startsWith("wiki/")) {
    form.value.slug =
      "wiki/" +
      form.value.title
        .toLowerCase()
        .replace(/[^a-z0-9äöüß\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .slice(0, 80);
  }
}

async function createPage() {
  createError.value = "";
  try {
    await axios.post(`/api/v1/wiki/${workspaceId.value}/pages`, form.value);
    showCreate.value = false;
    form.value = { title: "", slug: "", page_type: "article" };
    await loadPages();
  } catch (e: any) {
    createError.value = e.response?.data?.error || "Fehler";
  }
}

function typeIcon(t: string) {
  return t === "entity"
    ? "👤"
    : t === "concept"
      ? "💡"
      : t === "youtube_transcript"
        ? "▶️"
        : "📄";
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

// ---- WeKnora Import ----

function onFileSelected(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    importJson.value = reader.result as string;
    parseImportJson();
  };
  reader.readAsText(file);
}

function parseImportJson() {
  try {
    const parsed = JSON.parse(importJson.value);
    const pages = Array.isArray(parsed) ? parsed : parsed.pages || [parsed];
    if (!Array.isArray(pages)) {
      importError.value = "Ungültiges JSON-Format";
      importParsed.value = null;
      importPreview.value = null;
      return;
    }
    importParsed.value = pages;
    importPreview.value = pages;

    const counts: Record<string, number> = {};
    for (const p of pages) {
      const t = p.page_type || "article";
      counts[t] = (counts[t] || 0) + 1;
    }
    importTypeCounts.value = counts;
    importError.value = "";
  } catch {
    importError.value = "Ungültiges JSON";
    importParsed.value = null;
    importPreview.value = null;
  }
}

function watchImportJson() {
  // Wird durch @input am textarea getriggert
}

async function startImport() {
  if (!importParsed.value || importParsed.value.length === 0) return;

  importing.value = true;
  importError.value = "";
  importResult.value = null;

  try {
    const res = await axios.post(`/api/v1/wiki/${workspaceId.value}/import`, {
      pages: importParsed.value,
    });
    importResult.value = res.data;
    importJson.value = "";
    importParsed.value = null;
    importPreview.value = null;
    await loadPages();
  } catch (e: any) {
    importError.value = e.response?.data?.error || e.message;
  } finally {
    importing.value = false;
  }
}

function closeImport() {
  showImport.value = false;
  importJson.value = "";
  importing.value = false;
  importError.value = "";
  importResult.value = null;
  importParsed.value = null;
  importPreview.value = null;
  if (fileInput.value) fileInput.value.value = "";
}
</script>

<style scoped>
.wiki-main {
  flex: 1;
}
.wiki-header {
  padding: 1rem 1.5rem;
  border-bottom: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}
.wiki-header h3 {
  flex-shrink: 0;
}
.header-actions {
  display: flex;
  gap: 0.5rem;
  margin-left: auto;
}
.wiki-subtitle {
  color: var(--color-text-secondary);
  font-size: 0.875rem;
}
.wiki-toolbar {
  padding: 0.75rem 1.5rem;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  border-bottom: 1px solid var(--color-border);
}
.search-input {
  flex: 1;
  max-width: 400px;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  color: var(--color-text);
  font-size: 0.875rem;
}
.page-count {
  color: var(--color-text-secondary);
  font-size: 0.85rem;
  white-space: nowrap;
}
.wiki-content {
  padding: 1rem 1.5rem;
}
.wiki-empty {
  padding: 4rem 1.5rem;
  text-align: center;
  color: var(--color-text-secondary);
}
.status-text {
  padding: 2rem;
  text-align: center;
  color: var(--color-text-secondary);
}
.page-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.page-card {
  display: flex;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
}
.page-card:hover {
  background: var(--color-bg-secondary);
}
.page-type-badge {
  font-size: 1.3rem;
  line-height: 1.4;
  flex-shrink: 0;
}
.page-info {
  flex: 1;
  min-width: 0;
}
.page-info h4 {
  font-size: 0.95rem;
  margin-bottom: 0.15rem;
  color: var(--color-text);
}
.page-summary {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.page-meta {
  display: flex;
  gap: 0.75rem;
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  margin-top: 0.3rem;
}
.ws-select {
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  color: var(--color-text);
  font-size: 0.85rem;
  max-width: 260px;
}

/* Buttons */
.btn-primary,
.btn-secondary {
  padding: 0.4rem 0.85rem;
  border-radius: 6px;
  font-size: 0.85rem;
  font-weight: 500;
  border: none;
  cursor: pointer;
  transition: opacity 0.15s;
  white-space: nowrap;
}
.btn-primary {
  background: var(--color-primary);
  color: #fff;
}
.btn-primary:hover {
  opacity: 0.9;
}
.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn-secondary {
  background: var(--color-bg-secondary);
  color: var(--color-text);
  border: 1px solid var(--color-border);
}
.btn-secondary:hover {
  background: var(--color-border);
}

/* Dialog */
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.dialog {
  background: var(--color-bg);
  border-radius: 12px;
  padding: 1.5rem;
  width: 90%;
  max-width: 480px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}
.dialog-wide {
  max-width: 640px;
}
.dialog h3 {
  margin-bottom: 1rem;
  font-size: 1.1rem;
}
.dialog-hint {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  margin-bottom: 1rem;
  line-height: 1.5;
}
.dialog-hint code {
  background: var(--color-bg-secondary);
  padding: 0.1rem 0.3rem;
  border-radius: 3px;
  font-size: 0.85em;
}
.field {
  margin-bottom: 0.75rem;
}
.field label {
  display: block;
  font-size: 0.8rem;
  font-weight: 600;
  margin-bottom: 0.3rem;
  color: var(--color-text-secondary);
}
.field input,
.field select {
  width: 100%;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  color: var(--color-text);
  font-size: 0.9rem;
}
.file-input {
  padding: 0.5rem 0 !important;
  border: none !important;
}
.import-textarea {
  width: 100%;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  color: var(--color-text);
  font-family: "SF Mono", Monaco, "Cascadia Code", monospace;
  font-size: 0.8rem;
  line-height: 1.5;
  resize: vertical;
}
.dialog-actions {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
  margin-top: 1rem;
}
.error {
  color: #ef4444;
  font-size: 0.85rem;
  margin-top: 0.5rem;
}
.success {
  color: #22c55e;
  font-size: 0.9rem;
  font-weight: 600;
}
.warning {
  color: #f59e0b;
  font-size: 0.85rem;
}

/* Import Preview */
.import-preview {
  padding: 0.75rem;
  background: var(--color-bg-secondary);
  border-radius: 6px;
  margin-bottom: 0.75rem;
  font-size: 0.85rem;
}
.import-preview p {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.import-result {
  padding: 0.75rem;
  background: var(--color-bg-secondary);
  border-radius: 6px;
  margin-bottom: 0.75rem;
}
.import-errors {
  margin-top: 0.5rem;
}
</style>
