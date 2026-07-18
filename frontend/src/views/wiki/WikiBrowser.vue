<template>
  <div class="wiki-layout">
    <!-- Left sidebar: Search + Tabs + Page list -->
    <aside class="wiki-sidebar">
      <div class="sidebar-search">
        <input
          v-model="searchQuery"
          @input="onSearch"
          placeholder="Wiki durchsuchen..."
          class="search-input"
        />
      </div>

      <div class="sidebar-tabs">
        <button
          v-for="tab in tabs"
          :key="tab.type"
          :class="['tab', { active: activeTab === tab.type }]"
          @click="setActiveTab(tab.type)"
        >
          <span>{{ tab.label }}</span>
          <span class="tab-count">{{ tab.total }}</span>
        </button>
      </div>

      <div class="sidebar-list">
        <div v-if="loading" class="list-status">Lade...</div>
        <div v-else-if="pages.length === 0" class="list-status">
          <p v-if="activeTab === 'summary'">
            Keine Artikel. Importiere ein Dokument um Wiki-Seiten zu generieren.
          </p>
          <p v-else>
            Keine
            {{ activeTab === "entity" ? "Entitäten" : "Konzepte" }} gefunden.
          </p>
        </div>
        <div v-else class="page-list">
          <div
            v-for="p in pages"
            :key="p.id"
            :class="['page-item', { active: selectedSlug === p.slug }]"
            @click="selectPage(p)"
          >
            <div class="page-item-title">{{ stripWikiLinks(p.title) }}</div>
            <div class="page-item-summary">{{ stripWikiLinks(p.summary) }}</div>
            <div class="page-item-meta">
              <span>{{ formatDate(p.updated_at) }}</span>
              <span v-if="p.out_links?.length">{{ p.out_links.length }} →</span>
              <span v-if="p.in_links?.length">{{ p.in_links.length }} ←</span>
            </div>
          </div>
        </div>
      </div>
    </aside>

    <!-- Right content: Reader -->
    <div class="wiki-reader">
      <template v-if="!selectedPage">
        <div class="reader-index" v-if="indexIntro">
          <div class="index-intro" v-html="renderedIndexIntro"></div>
          <div class="index-stats">
            <div class="stat-card" v-for="s in stats" :key="s.label">
              <span class="stat-number">{{ s.count }}</span>
              <span class="stat-label">{{ s.label }}</span>
            </div>
          </div>
        </div>
        <div class="reader-empty" v-else>
          <p>Wähle eine Seite aus der Sidebar oder durchsuche das Wiki.</p>
          <p v-if="workspaceId" class="reader-actions">
            <button class="btn-primary" @click="showImport = true">
              📥 WeKnora importieren
            </button>
          </p>
        </div>
      </template>

      <template v-else>
        <div class="reader-header">
          <button class="btn-back" @click="goBackToOverview">
            ← Übersicht
          </button>
          <h2>{{ stripWikiLinks(selectedPage.title) }}</h2>
          <div class="reader-meta">
            <span :class="['type-tag', selectedPage.page_type]">
              {{ typeLabel(selectedPage.page_type) }}
            </span>
            <span>Version {{ selectedPage.version }}</span>
            <span>{{ formatDate(selectedPage.updated_at) }}</span>
          </div>
          <div v-if="selectedPage.aliases?.length" class="reader-aliases">
            <strong>Aliase:</strong>
            <span
              v-for="a in selectedPage.aliases"
              :key="a"
              class="alias-tag"
              >{{ a }}</span
            >
          </div>
        </div>

        <div class="reader-body" v-html="renderedContent"></div>

        <div class="reader-footer">
          <div v-if="selectedPage.out_links?.length" class="links-section">
            <h4>→ Verlinkt zu</h4>
            <div class="link-chips">
              <span
                v-for="slug in selectedPage.out_links"
                :key="slug"
                class="link-chip"
                @click="navigateToSlug(slug)"
                >{{ slugLabel(slug) }}</span
              >
            </div>
          </div>
          <div v-if="selectedPage.in_links?.length" class="links-section">
            <h4>← Verlinkt von</h4>
            <div class="link-chips">
              <span
                v-for="slug in selectedPage.in_links"
                :key="slug"
                class="link-chip"
                @click="navigateToSlug(slug)"
                >{{ slugLabel(slug) }}</span
              >
            </div>
          </div>
        </div>
      </template>

      <!-- Import Dialog -->
      <div
        v-if="showImport"
        class="dialog-overlay"
        @click.self="showImport = false"
      >
        <div class="dialog dialog-wide">
          <h3>📥 WeKnora Import</h3>
          <p class="dialog-hint">
            Importiere Wiki-Seiten aus einem WeKnora-JSON-Export.
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
              📊 {{ importPreview.length }} Seiten:
              <span v-for="(count, type) in importTypeCounts" :key="type"
                >{{ type }}: {{ count }}
              </span>
            </p>
          </div>
          <div v-if="importResult" class="import-result">
            <p class="success">✅ {{ importResult.imported }} importiert</p>
            <p v-if="importResult.skipped" class="warning">
              ⏭️ {{ importResult.skipped }} übersprungen
            </p>
          </div>
          <div class="dialog-actions">
            <button class="btn-secondary" @click="closeImport">
              Schließen
            </button>
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
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useAuthStore } from "../../stores/auth";
import { useWorkspace } from "../../composables/useWorkspace";
import axios from "axios";

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();
const { resolveWorkspace, isUUID } = useWorkspace();

const rawWorkspaceId = computed(
  () => ((route.params.id || route.params.workspaceId) as string) || "",
);
const workspaceId = ref(rawWorkspaceId.value);
const urlSlug = computed(() => (route.params.slug as string) || "");

// Sidebar state
const searchQuery = ref("");
const activeTab = ref("summary");
const pages = ref<any[]>([]);
const totalPages = ref(0);
const loading = ref(false);
const tabs = ref<{ type: string; label: string; total: number }[]>([
  { type: "summary", label: "Summaries", total: 0 },
  { type: "entity", label: "Entities", total: 0 },
  { type: "concept", label: "Concepts", total: 0 },
]);

// Reader state
const selectedPage = ref<any>(null);
const selectedSlug = ref("");
const indexIntro = ref("");
const stats = ref<{ label: string; count: number }[]>([]);

// Import state
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

  // Workspace-Slug → UUID auflösen
  if (rawWorkspaceId.value && !isUUID(rawWorkspaceId.value)) {
    const resolved = await resolveWorkspace(rawWorkspaceId.value);
    if (resolved) {
      workspaceId.value = resolved.id;
    } else {
      console.error("[wiki] Workspace nicht gefunden:", rawWorkspaceId.value);
    }
  }

  if (workspaceId.value) {
    await loadIndex();
    await loadStats();
    await loadPages();

    // Wenn eine Slug in der URL steht, diese Seite automatisch laden
    if (urlSlug.value) {
      await navigateToSlug(urlSlug.value);
    }
  }
});

// Bei Routenänderung (z.B. andere workspaceId in URL) neu laden
watch(rawWorkspaceId, async (newVal) => {
  if (newVal && !isUUID(newVal)) {
    const resolved = await resolveWorkspace(newVal);
    if (resolved) workspaceId.value = resolved.id;
  } else if (newVal) {
    workspaceId.value = newVal;
  }
  selectedPage.value = null;
  selectedSlug.value = "";
  if (workspaceId.value) {
    loadIndex();
    loadStats();
    loadPages();
  }
});

watch(workspaceId, () => {
  if (workspaceId.value) {
    selectedPage.value = null;
    selectedSlug.value = "";
    loadIndex();
    loadStats();
    loadPages();
  }
});

// ---- Index ----

async function loadIndex() {
  if (!workspaceId.value) return;
  try {
    const res = await axios.get(`/api/v1/wiki/${workspaceId.value}/index`);
    indexIntro.value = res.data.intro || "";
  } catch {
    /* no index yet */
  }
}

// ---- Stats ----

async function loadStats() {
  if (!workspaceId.value) return;
  try {
    const res = await axios.get(`/api/v1/wiki/${workspaceId.value}/stats`);
    const data = res.data;
    const byType = data.pages_by_type || {};
    tabs.value = tabs.value.map((t) => ({
      ...t,
      total: byType[t.type] || 0,
    }));
    stats.value = [
      { label: "Summaries", count: byType.summary || 0 },
      { label: "Entities", count: byType.entity || 0 },
      { label: "Concepts", count: byType.concept || 0 },
      { label: "Gesamt", count: data.total_pages || 0 },
    ];
  } catch {
    /* ignore */
  }
}

// ---- Pages ----

async function loadPages() {
  if (!workspaceId.value) return;
  loading.value = true;
  try {
    const params: any = { page_type: activeTab.value, page_size: 100 };
    if (searchQuery.value) params.query = searchQuery.value;
    const res = await axios.get(`/api/v1/wiki/${workspaceId.value}/pages`, {
      params,
    });
    pages.value = res.data.pages || [];
    totalPages.value = res.data.total || 0;
  } catch (e: any) {
    console.error("[wiki] load error", e);
  } finally {
    loading.value = false;
  }
}

function setActiveTab(type: string) {
  activeTab.value = type;
  selectedPage.value = null;
  selectedSlug.value = "";
  loadPages();
}

function onSearch() {
  loadPages();
}

function goBackToOverview() {
  selectedPage.value = null;
  selectedSlug.value = "";
  // URL zurücksetzen
  const base = `/workspaces/${workspaceId.value}/wiki`;
  window.history.replaceState(null, "", base);
}

function selectPage(p: any) {
  selectedPage.value = p;
  selectedSlug.value = p.slug;
  // URL für Bookmarkability aktualisieren
  const base = `/workspaces/${workspaceId.value}/wiki`;
  window.history.replaceState(
    null,
    "",
    `${base}/${encodeURIComponent(p.slug)}`,
  );
}

async function navigateToSlug(slug: string) {
  if (!workspaceId.value) return;
  try {
    const res = await axios.get(
      `/api/v1/wiki/${workspaceId.value}/pages/${encodeURIComponent(slug)}`,
    );
    if (res.data.page) {
      selectedPage.value = res.data.page;
      selectedSlug.value = slug;
      // URL für Bookmarkability aktualisieren
      const base = `/workspaces/${workspaceId.value}/wiki`;
      window.history.replaceState(
        null,
        "",
        `${base}/${encodeURIComponent(slug)}`,
      );
    }
  } catch {
    /* ignore */
  }
}

// ---- Rendering ----

const renderedContent = computed(() => {
  if (!selectedPage.value?.content) return "";
  return renderWikiContent(selectedPage.value.content);
});

const renderedIndexIntro = computed(() => {
  if (!indexIntro.value) return "";
  return renderWikiContent(indexIntro.value);
});

function renderWikiContent(content: string): string {
  let html = content.replace(
    /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
    (_match: string, slug: string, text?: string) => {
      const label = text || slug.replace(/^.*\//, "").replace(/-/g, " ");
      const encoded = encodeURIComponent(slug);
      return `<a href="/workspaces/${workspaceId.value}/wiki/${encoded}" class="wiki-link">${label}</a>`;
    },
  );

  html = html
    .replace(/^### (.+)$/gm, "<h4>$1</h4>")
    .replace(/^## (.+)$/gm, "<h3>$1</h3>")
    .replace(/^# (.+)$/gm, "<h2>$1</h2>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>\n?)+/g, "<ul>$&</ul>")
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br/>");

  return `<p>${html}</p>`;
}

function slugLabel(slug: string): string {
  return slug.split("/").pop()?.replace(/-/g, " ") || slug;
}

// Wiki-Link-Syntax [[slug|text]] in Titeln/Summaries zu reinem Anzeigetext auflösen
function stripWikiLinks(text: string): string {
  if (!text) return text;
  return text.replace(
    /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
    (_match: string, slug: string, label?: string) =>
      label || slug.replace(/^.*\//, "").replace(/-/g, " "),
  );
}

function typeLabel(type: string): string {
  const map: Record<string, string> = {
    summary: "📄 Zusammenfassung",
    entity: "👤 Entität",
    concept: "💡 Konzept",
    article: "📄 Artikel",
    index: "📋 Index",
    log: "📝 Log",
  };
  return map[type] || type;
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

// ---- Import ----

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
    const list = Array.isArray(parsed) ? parsed : parsed.pages || [parsed];
    if (!Array.isArray(list)) {
      importError.value = "Ungültiges Format";
      return;
    }
    importParsed.value = list;
    importPreview.value = list;
    const counts: Record<string, number> = {};
    for (const p of list) {
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

async function startImport() {
  if (!importParsed.value?.length) return;
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
    await loadStats();
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
.wiki-layout {
  display: flex;
  height: 100%;
  overflow: hidden;
}

/* ---- Sidebar ---- */
.wiki-sidebar {
  width: 340px;
  min-width: 340px;
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  background: var(--color-bg);
  overflow: hidden;
}

.sidebar-search {
  padding: 0.75rem;
  border-bottom: 1px solid var(--color-border);
}

.search-input {
  width: 100%;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg-secondary);
  color: var(--color-text);
  font-size: 0.875rem;
  outline: none;
}
.search-input:focus {
  border-color: var(--color-primary);
}

.sidebar-tabs {
  display: flex;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.sidebar-tabs .tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  padding: 0.6rem 0.5rem;
  border: none;
  background: none;
  color: var(--color-text-secondary);
  font-size: 0.8rem;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all 0.15s;
  font-family: inherit;
}
.sidebar-tabs .tab:hover {
  color: var(--color-text);
  background: var(--color-bg-secondary);
}
.sidebar-tabs .tab.active {
  color: var(--color-primary);
  border-bottom-color: var(--color-primary);
  font-weight: 600;
}

.tab-count {
  font-size: 0.7rem;
  padding: 0.1rem 0.35rem;
  border-radius: 8px;
  background: var(--color-bg-secondary);
  color: var(--color-text-secondary);
}

.sidebar-list {
  flex: 1;
  overflow-y: auto;
}
.list-status {
  padding: 2rem 1rem;
  text-align: center;
  color: var(--color-text-secondary);
  font-size: 0.875rem;
}
.page-list {
  padding: 0.25rem;
}

.page-item {
  padding: 0.65rem 0.75rem;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.1s;
  margin-bottom: 2px;
}
.page-item:hover {
  background: var(--color-bg-secondary);
}
.page-item.active {
  background: var(--color-sidebar-active);
  color: #fff;
}

.page-item-title {
  font-weight: 600;
  font-size: 0.9rem;
  margin-bottom: 0.2rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.page-item-summary {
  font-size: 0.78rem;
  color: var(--color-text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin-bottom: 0.2rem;
}
.page-item.active .page-item-summary {
  color: rgba(255, 255, 255, 0.8);
}
.page-item-meta {
  display: flex;
  gap: 0.5rem;
  font-size: 0.7rem;
  color: var(--color-text-secondary);
}
.page-item.active .page-item-meta {
  color: rgba(255, 255, 255, 0.7);
}

/* ---- Reader ---- */
.wiki-reader {
  flex: 1;
  overflow-y: auto;
  padding: 1.5rem 2rem;
  background: var(--color-content-bg);
}
.reader-index {
  max-width: 700px;
  margin: 0 auto;
}
.index-intro {
  font-size: 1rem;
  line-height: 1.7;
  margin-bottom: 2rem;
}

.index-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 1rem;
}
.stat-card {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 1.25rem;
  text-align: center;
}
.stat-number {
  display: block;
  font-size: 1.75rem;
  font-weight: 700;
  color: var(--color-primary);
}
.stat-label {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  margin-top: 0.25rem;
}

.reader-empty {
  text-align: center;
  padding: 3rem;
  color: var(--color-text-secondary);
}
.reader-actions {
  margin-top: 1rem;
}

.reader-header {
  border-bottom: 1px solid var(--color-border);
  padding-bottom: 1rem;
  margin-bottom: 1.5rem;
}
.reader-header h2 {
  margin: 0.5rem 0;
  font-size: 1.4rem;
  line-height: 1.3;
}
.reader-meta {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  flex-wrap: wrap;
}

.type-tag {
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
}
.type-tag.summary {
  background: #e8f4fd;
  color: #0052d9;
}
.type-tag.entity {
  background: #e8f8ee;
  color: #2ba471;
}
.type-tag.concept {
  background: #fef3e2;
  color: #e37318;
}
.type-tag.article {
  background: #f0f0f0;
  color: #666;
}

.reader-aliases {
  display: flex;
  gap: 0.4rem;
  align-items: center;
  margin-top: 0.5rem;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  flex-wrap: wrap;
}
.alias-tag {
  padding: 0.1rem 0.4rem;
  border-radius: 3px;
  background: var(--color-bg-secondary);
  font-size: 0.75rem;
}

.reader-body {
  line-height: 1.8;
  font-size: 0.95rem;
  max-width: 750px;
}
.reader-body :deep(h2) {
  font-size: 1.25rem;
  margin: 1.5rem 0 0.75rem;
}
.reader-body :deep(h3) {
  font-size: 1.1rem;
  margin: 1.25rem 0 0.5rem;
}
.reader-body :deep(h4) {
  font-size: 1rem;
  margin: 1rem 0 0.5rem;
}
.reader-body :deep(p) {
  margin-bottom: 0.75rem;
}
.reader-body :deep(ul) {
  margin: 0.5rem 0 0.75rem 1.5rem;
}
.reader-body :deep(li) {
  margin-bottom: 0.25rem;
}
.reader-body :deep(.wiki-link) {
  color: var(--color-primary);
  text-decoration: underline;
  text-decoration-style: dotted;
  cursor: pointer;
}
.reader-body :deep(.wiki-link:hover) {
  text-decoration-style: solid;
}

.reader-footer {
  margin-top: 2rem;
  padding-top: 1rem;
  border-top: 1px solid var(--color-border);
}
.links-section {
  margin-bottom: 0.75rem;
}
.links-section h4 {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  margin-bottom: 0.4rem;
}
.link-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
.link-chip {
  padding: 0.2rem 0.5rem;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  font-size: 0.78rem;
  cursor: pointer;
  transition: background 0.1s;
  font-family: inherit;
}
.link-chip:hover {
  background: var(--color-primary);
  color: #fff;
  border-color: var(--color-primary);
}

.btn-back {
  background: none;
  border: none;
  color: var(--color-primary);
  cursor: pointer;
  font-size: 0.875rem;
  padding: 0;
  font-family: inherit;
}
.btn-back:hover {
  text-decoration: underline;
}

/* ---- Dialogs ---- */
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.dialog {
  background: var(--color-bg);
  border-radius: 10px;
  padding: 1.5rem;
  min-width: 400px;
  max-width: 600px;
  max-height: 80vh;
  overflow-y: auto;
}
.dialog-wide {
  min-width: 500px;
}
.dialog h3 {
  margin-bottom: 1rem;
}
.dialog-hint {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  margin-bottom: 1rem;
}
.field {
  margin-bottom: 0.75rem;
}
.field label {
  display: block;
  font-size: 0.8rem;
  font-weight: 600;
  margin-bottom: 0.25rem;
}
.field input,
.field select,
.field textarea {
  width: 100%;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  color: var(--color-text);
  font-size: 0.9rem;
  font-family: inherit;
}
.import-textarea {
  font-family: monospace;
  font-size: 0.8rem;
}
.dialog-actions {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
  margin-top: 1rem;
}
.import-preview,
.import-result {
  padding: 0.5rem;
  border-radius: 6px;
  background: var(--color-bg-secondary);
  font-size: 0.85rem;
  margin-bottom: 0.5rem;
}
.error {
  color: #e74c3c;
  font-size: 0.85rem;
}
.success {
  color: #27ae60;
  font-size: 0.85rem;
}
.warning {
  color: #f39c12;
  font-size: 0.85rem;
}

.btn-primary {
  padding: 0.45rem 1rem;
  background: var(--color-primary);
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.875rem;
  font-family: inherit;
}
.btn-primary:disabled {
  opacity: 0.5;
  cursor: default;
}
.btn-secondary {
  padding: 0.45rem 1rem;
  background: var(--color-bg-secondary);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.875rem;
  font-family: inherit;
}
</style>
