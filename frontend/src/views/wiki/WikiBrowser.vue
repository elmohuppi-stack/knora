<template>
  <div class="wiki-layout" :class="{ reader: selectedPage }">
    <!-- Facetten-Rail (Discovery) / Filter + Ergebnis-Navigation (Reader) -->
    <aside class="wiki-rail">
      <div class="rail-search">
        <input
          v-model="searchQuery"
          @input="onSearch"
          placeholder="🔍 Wiki durchsuchen..."
          class="search-input"
        />
      </div>

      <!-- Im Reader-Modus einklappbar; in Discovery immer offen -->
      <button
        v-if="selectedPage"
        class="rail-toggle"
        @click="showFacets = !showFacets"
      >
        <span>{{ showFacets ? "▾" : "▸" }} Filter</span>
        <span v-if="activeFilterCount" class="cnt">{{ activeFilterCount }}</span>
      </button>

      <div class="rail-facets" v-show="!selectedPage || showFacets">
        <div class="facet-group">
          <div class="facet-label">Typ</div>
          <div class="type-facets">
            <button
              v-for="tab in tabs"
              :key="tab.type"
              :class="['type-facet', { active: activeTab === tab.type }]"
              @click="setActiveTab(tab.type)"
            >
              <span>{{ tab.label }}</span>
              <span class="cnt">{{ tab.total }}</span>
            </button>
          </div>
        </div>

        <div class="facet-group" v-if="allTopics.length">
          <div class="facet-label">Themen</div>
          <div class="topic-facets">
            <button
              v-for="t in allTopics"
              :key="t.id"
              :class="['topic-facet', { active: filterTopicIds.includes(t.id) }]"
              @click="toggleTopicFilter(t.id)"
            >
              <span>{{ t.label }}</span>
              <span class="cnt" v-if="t.doc_count">{{ t.doc_count }}</span>
            </button>
          </div>
        </div>

        <div class="facet-group" v-if="topConceptsList.length">
          <div class="facet-label">Top-Konzepte</div>
          <div class="topic-facets">
            <button
              v-for="c in topConceptsList"
              :key="c.id"
              :class="['topic-facet', { active: filterReferences === c.slug }]"
              @click="setReferenceFilter(c.slug, stripWikiLinks(c.title))"
              :title="`${c.connections} Artikel verweisen darauf`"
            >
              <span>{{ stripWikiLinks(c.title) }}</span>
              <span class="cnt">{{ c.connections }}</span>
            </button>
          </div>
        </div>

        <div class="facet-group" v-if="channels.length">
          <div class="facet-label">Kanal</div>
          <select v-model="filterChannel" @change="applyFilters" class="facet-select">
            <option value="">Alle Kanäle</option>
            <option v-for="ch in channels" :key="ch" :value="ch">{{ ch }}</option>
          </select>
        </div>

        <div class="facet-group">
          <div class="facet-label">Zeitraum (Import-Datum)</div>
          <DatePicker
            v-model="filterDates"
            selectionMode="range"
            :manualInput="false"
            showIcon
            showButtonBar
            iconDisplay="input"
            dateFormat="dd.mm.yy"
            placeholder="Zeitraum"
            class="facet-datepicker"
          />
        </div>

        <div class="facet-group">
          <div class="facet-label">Sortierung</div>
          <select v-model="sortBy" @change="applyFilters" class="facet-select">
            <option value="updated_desc">Zuletzt aktualisiert</option>
            <option value="updated_asc">Älteste zuerst</option>
            <option value="published_desc">Video-Datum ↓</option>
            <option value="published_asc">Video-Datum ↑</option>
            <option value="title_asc">Titel A–Z</option>
            <option value="title_desc">Titel Z–A</option>
            <option value="connections_desc">Meiste Verknüpfungen</option>
          </select>
        </div>

        <button v-if="hasActiveFilters" class="btn-clear" @click="clearFilters">
          ✕ Filter zurücksetzen
        </button>
      </div>

      <!-- Reader: kompakte Ergebnisliste zum Weiterblättern -->
      <div class="rail-results" v-if="selectedPage">
        <div class="rail-results-head">{{ total }} Treffer</div>
        <div
          v-for="p in pages"
          :key="p.id"
          :class="['rail-result', { active: selectedSlug === p.slug }]"
          @click="selectPage(p)"
        >
          {{ stripWikiLinks(p.title) }}
        </div>
      </div>
    </aside>

    <!-- Hauptbereich -->
    <main class="wiki-main">
      <!-- DISCOVERY -->
      <template v-if="!selectedPage">
        <div class="discovery-head">
          <div class="result-count">
            <strong>{{ total }}</strong> {{ typeLabelPlural }}
          </div>
          <div class="active-chips" v-if="hasActiveFilters">
            <span v-if="searchQuery" class="chip">
              „{{ searchQuery }}"
              <button @click="clearSearch">✕</button>
            </span>
            <span v-if="filterChannel" class="chip">
              📺 {{ filterChannel }}
              <button @click="clearChannel">✕</button>
            </span>
            <span v-if="dateRangeLabel" class="chip">
              📅 {{ dateRangeLabel }}
              <button @click="clearDates">✕</button>
            </span>
            <span v-for="t in selectedTopics" :key="t.id" class="chip">
              🏷️ {{ t.label }}
              <button @click="toggleTopicFilter(t.id)">✕</button>
            </span>
            <span v-if="filterReferences" class="chip chip-ref">
              🔎 verweist auf „{{ refDisplay }}"
              <button @click="clearReferences">✕</button>
            </span>
          </div>
        </div>

        <div v-if="!hasActiveFilters && stats.length" class="stats-band">
          <button
            class="stat-card"
            v-for="s in stats"
            :key="s.label"
            :disabled="!s.type"
            @click="s.type && setActiveTab(s.type)"
          >
            <span class="stat-number">{{ s.count }}</span>
            <span class="stat-label">{{ s.label }}</span>
          </button>
        </div>

        <div v-if="loading" class="list-status">Lade...</div>
        <div v-else-if="pages.length === 0" class="list-status empty">
          <p v-if="hasActiveFilters">Keine Treffer für die aktuellen Filter.</p>
          <p v-else-if="activeTab === 'summary'">
            Keine Artikel. Importiere ein Dokument, um Wiki-Seiten zu generieren.
          </p>
          <p v-else>
            Keine
            {{ activeTab === "entity" ? "Entitäten" : "Konzepte" }} gefunden.
          </p>
          <p v-if="workspaceId && !hasActiveFilters" class="reader-actions">
            <button class="btn-primary" @click="showImport = true">
              📥 WeKnora importieren
            </button>
          </p>
        </div>

        <div v-else class="result-grid">
          <article
            v-for="p in pages"
            :key="p.id"
            class="result-card"
            @click="selectPage(p)"
          >
            <span :class="['card-type', p.page_type]">{{
              typeLabel(p.page_type)
            }}</span>
            <h3 class="card-title">{{ stripWikiLinks(p.title) }}</h3>
            <p class="card-summary">{{ stripWikiLinks(p.summary) }}</p>
            <div class="card-meta">
              <span>{{ formatDate(p.updated_at) }}</span>
              <span v-if="p.out_links?.length">{{ p.out_links.length }} →</span>
              <span v-if="p.in_links?.length">{{ p.in_links.length }} ←</span>
            </div>
          </article>
        </div>
      </template>

      <!-- READER -->
      <template v-else>
        <div class="reader-header">
          <button class="btn-back" @click="goBackToOverview">
            ← Zurück zu Ergebnissen
          </button>
          <h2>{{ stripWikiLinks(selectedPage.title) }}</h2>
          <div class="reader-meta">
            <span :class="['type-tag', selectedPage.page_type]">
              {{ typeLabel(selectedPage.page_type) }}
            </span>
            <span>Version {{ selectedPage.version }}</span>
            <span>{{ formatDate(selectedPage.updated_at) }}</span>
            <span
              v-if="selectedPage.manually_edited"
              class="lock-badge"
              title="Manuell bearbeitet – wird von der Auto-Generierung nicht überschrieben"
              >🔒 manuell</span
            >
          </div>
          <div class="reader-actions-bar" v-if="!editing">
            <button
              v-if="['concept', 'entity'].includes(selectedPage.page_type)"
              class="btn-mini"
              @click="setReferenceFilter(selectedSlug, stripWikiLinks(selectedPage.title))"
            >
              🔎 Artikel dazu
            </button>
            <button class="btn-mini" @click="startEdit">✏️ Bearbeiten</button>
            <button class="btn-mini" @click="openRevisions">🕘 Verlauf</button>
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

        <div
          v-if="!editing"
          class="reader-body"
          v-html="renderedContent"
          @click="onBodyClick"
        ></div>

        <!-- Edit-Modus (Markdown + Link-Toolbar) -->
        <div v-else class="reader-edit">
          <label class="edit-label">Titel</label>
          <input v-model="editTitle" class="edit-input" />
          <label class="edit-label">Zusammenfassung</label>
          <input v-model="editSummary" class="edit-input" />
          <label class="edit-label">Inhalt (Markdown)</label>
          <div class="edit-toolbar">
            <button class="btn-mini" @click="insertLink" title="Externen Link einfügen">
              🔗 Link
            </button>
            <span class="edit-hint">
              [[seite]] = interner Link · [Text](https://…) = externer Link
            </span>
          </div>
          <textarea
            ref="editTextarea"
            v-model="editContent"
            class="edit-textarea"
            rows="20"
          ></textarea>
          <div class="edit-actions">
            <button class="btn-secondary" @click="cancelEdit">Abbrechen</button>
            <button class="btn-primary" @click="saveEdit" :disabled="saving">
              {{ saving ? "⏳ Speichern..." : "💾 Speichern" }}
            </button>
          </div>
        </div>

        <div v-if="!editing" class="reader-footer">
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

      <!-- Versions-Historie (Ebene 4) -->
      <div
        v-if="showRevisions"
        class="dialog-overlay"
        @click.self="showRevisions = false"
      >
        <div class="dialog">
          <h3>🕘 Versions-Historie</h3>
          <p class="dialog-hint" v-if="!revisions.length">
            Noch keine früheren Fassungen. Bei jeder manuellen Bearbeitung wird
            die vorige Version hier gesichert.
          </p>
          <div v-else class="rev-list">
            <div v-for="rev in revisions" :key="rev.id" class="rev-item">
              <div class="rev-info">
                <span class="rev-ver">v{{ rev.version }}</span>
                <span class="rev-date">{{ formatDateTime(rev.created_at) }}</span>
              </div>
              <button
                class="btn-mini"
                @click="restoreRevision(rev)"
                :disabled="restoringId === rev.id"
              >
                {{ restoringId === rev.id ? "⏳..." : "↩︎ Wiederherstellen" }}
              </button>
            </div>
          </div>
          <div class="dialog-actions">
            <button class="btn-secondary" @click="showRevisions = false">
              Schließen
            </button>
          </div>
        </div>
      </div>

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
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useAuthStore } from "../../stores/auth";
import { useWorkspace } from "../../composables/useWorkspace";
import DatePicker from "primevue/datepicker";
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

// Filter-/Facetten-State
const searchQuery = ref("");
const activeTab = ref("summary");
const filterChannel = ref("");
const filterDates = ref<(Date | null)[] | null>(null);
const sortBy = ref("updated_desc");
const channels = ref<string[]>([]);
const allTopics = ref<any[]>([]);
const filterTopicIds = ref<string[]>([]);
// Ebene 3: Backlink-Filter (Slug eines Concepts/Entity) + Top-Konzepte
const filterReferences = ref("");
const refLabel = ref("");
const topConceptsList = ref<any[]>([]);
const showFacets = ref(false);

const pages = ref<any[]>([]);
const total = ref(0);
const loading = ref(false);
const tabs = ref<{ type: string; label: string; total: number }[]>([
  { type: "summary", label: "Summaries", total: 0 },
  { type: "entity", label: "Entities", total: 0 },
  { type: "concept", label: "Concepts", total: 0 },
]);

// Reader state
const selectedPage = ref<any>(null);
const selectedSlug = ref("");
// Ebene 4: Bearbeiten + Historie
const editing = ref(false);
const editTitle = ref("");
const editSummary = ref("");
const editContent = ref("");
const saving = ref(false);
const editTextarea = ref<HTMLTextAreaElement>();
const showRevisions = ref(false);
const revisions = ref<any[]>([]);
const restoringId = ref<number | null>(null);
const indexIntro = ref("");
const stats = ref<{ label: string; count: number; type: string | null }[]>([]);

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

let searchDebounce: ReturnType<typeof setTimeout> | null = null;
let ready = false; // verhindert Auto-Reload durch Watcher während Initialisierung

const base = computed(() => `/workspaces/${rawWorkspaceId.value}/wiki`);

const hasActiveFilters = computed(
  () =>
    !!(
      searchQuery.value ||
      filterChannel.value ||
      filterDates.value?.[0] ||
      filterTopicIds.value.length ||
      filterReferences.value
    ) || sortBy.value !== "updated_desc",
);
const activeFilterCount = computed(() => {
  let n = 0;
  if (searchQuery.value) n++;
  if (filterChannel.value) n++;
  if (filterDates.value?.[0]) n++;
  if (filterTopicIds.value.length) n += filterTopicIds.value.length;
  if (filterReferences.value) n++;
  if (sortBy.value !== "updated_desc") n++;
  return n;
});
const refDisplay = computed(
  () => refLabel.value || slugLabel(filterReferences.value),
);
const typeLabelPlural = computed(() => {
  const map: Record<string, string> = {
    summary: "Zusammenfassungen",
    entity: "Entitäten",
    concept: "Konzepte",
  };
  return map[activeTab.value] || "Seiten";
});
const dateRangeLabel = computed(() => {
  const d = filterDates.value;
  if (!d || !d[0]) return "";
  const f = (x: Date) => x.toLocaleDateString("de-DE");
  return d[1] ? `${f(d[0])} – ${f(d[1])}` : `ab ${f(d[0])}`;
});
const selectedTopics = computed(() =>
  allTopics.value.filter((t) => filterTopicIds.value.includes(t.id)),
);

onMounted(async () => {
  if (!auth.isAuthenticated) {
    router.push("/login");
    return;
  }
  if (rawWorkspaceId.value && !isUUID(rawWorkspaceId.value)) {
    const resolved = await resolveWorkspace(rawWorkspaceId.value);
    if (resolved) workspaceId.value = resolved.id;
    else console.error("[wiki] Workspace nicht gefunden:", rawWorkspaceId.value);
  }

  parseQueryFromUrl();

  if (workspaceId.value) {
    await Promise.all([
      loadIndex(),
      loadStats(),
      loadChannels(),
      loadTopics(),
      loadTopConcepts(),
    ]);
    await loadPages();
    if (urlSlug.value) await loadPageBySlug(urlSlug.value);
  }
  ready = true;
});

// Workspace-Wechsel via URL
watch(rawWorkspaceId, async (newVal) => {
  if (newVal && !isUUID(newVal)) {
    const resolved = await resolveWorkspace(newVal);
    if (resolved) workspaceId.value = resolved.id;
  } else if (newVal) {
    workspaceId.value = newVal;
  }
});
watch(workspaceId, () => {
  if (!workspaceId.value) return;
  selectedPage.value = null;
  selectedSlug.value = "";
  loadIndex();
  loadStats();
  loadChannels();
  loadPages();
});

// Browser Zurück/Vor (Slug ändert sich außerhalb der Klick-Handler)
watch(urlSlug, (slug) => {
  if (!ready) return;
  if (!slug) {
    selectedPage.value = null;
    selectedSlug.value = "";
  } else if (slug !== selectedSlug.value) {
    loadPageBySlug(slug);
  }
});

// Zeitraum-Auswahl: erst laden, wenn Bereich vollständig oder geleert
watch(filterDates, (val) => {
  if (!ready) return;
  if (!val || !val[0]) applyFilters();
  else if (val[0] && val[1]) applyFilters();
});

// ---- Laden ----

async function loadIndex() {
  if (!workspaceId.value) return;
  try {
    const res = await axios.get(`/api/v1/wiki/${workspaceId.value}/index`);
    indexIntro.value = res.data.intro || "";
  } catch {
    /* no index yet */
  }
}

async function loadStats() {
  if (!workspaceId.value) return;
  try {
    const res = await axios.get(`/api/v1/wiki/${workspaceId.value}/stats`);
    const byType = res.data.pages_by_type || {};
    tabs.value = tabs.value.map((t) => ({ ...t, total: byType[t.type] || 0 }));
    stats.value = [
      { label: "Summaries", count: byType.summary || 0, type: "summary" },
      { label: "Entities", count: byType.entity || 0, type: "entity" },
      { label: "Concepts", count: byType.concept || 0, type: "concept" },
      { label: "Gesamt", count: res.data.total_pages || 0, type: null },
    ];
  } catch {
    /* ignore */
  }
}

async function loadChannels() {
  if (!workspaceId.value) return;
  try {
    const res = await axios.get(
      `/api/v1/documents/${workspaceId.value}/channels`,
    );
    channels.value = res.data.channels || [];
  } catch {
    /* ignore */
  }
}

async function loadTopics() {
  if (!workspaceId.value) return;
  try {
    const res = await axios.get(`/api/v1/topics/${workspaceId.value}`);
    allTopics.value = res.data.topics || [];
  } catch {
    /* ignore */
  }
}
function toggleTopicFilter(id: string) {
  const i = filterTopicIds.value.indexOf(id);
  if (i >= 0) filterTopicIds.value.splice(i, 1);
  else filterTopicIds.value.push(id);
  applyFilters();
}

async function loadTopConcepts() {
  if (!workspaceId.value) return;
  try {
    const res = await axios.get(
      `/api/v1/wiki/${workspaceId.value}/concepts/top?limit=15`,
    );
    topConceptsList.value = (res.data.concepts || []).filter(
      (c: any) => c.connections > 0,
    );
  } catch {
    /* ignore */
  }
}

async function loadPages() {
  if (!workspaceId.value) return;
  loading.value = true;
  try {
    const params: Record<string, string> = {
      page_type: activeTab.value,
      page_size: "200",
      sort: sortBy.value,
    };
    if (searchQuery.value) params.query = searchQuery.value;
    if (filterChannel.value) params.channel = filterChannel.value;
    if (filterTopicIds.value.length)
      params.topics = filterTopicIds.value.join(",");
    if (filterReferences.value) params.references = filterReferences.value;
    const [from, to] = filterDates.value || [];
    if (from) params.from = `${toDateStr(from)}T00:00:00`;
    if (to) params.to = `${toDateStr(to)}T23:59:59`;
    const res = await axios.get(`/api/v1/wiki/${workspaceId.value}/pages`, {
      params,
    });
    pages.value = res.data.pages || [];
    total.value = res.data.total || 0;
  } catch (e: any) {
    console.error("[wiki] load error", e);
  } finally {
    loading.value = false;
  }
}

// ---- Filter-Aktionen + URL-Sync ----

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function buildQuery(): Record<string, string> {
  const q: Record<string, string> = {};
  if (searchQuery.value) q.q = searchQuery.value;
  if (activeTab.value !== "summary") q.type = activeTab.value;
  if (filterChannel.value) q.channel = filterChannel.value;
  if (filterTopicIds.value.length) q.topics = filterTopicIds.value.join(",");
  if (filterReferences.value) {
    q.ref = filterReferences.value;
    if (refLabel.value) q.refLabel = refLabel.value;
  }
  if (sortBy.value !== "updated_desc") q.sort = sortBy.value;
  const [from, to] = filterDates.value || [];
  if (from) q.from = toDateStr(from);
  if (to) q.to = toDateStr(to);
  return q;
}

function parseQueryFromUrl() {
  const q = route.query;
  if (typeof q.q === "string") searchQuery.value = q.q;
  if (typeof q.type === "string") activeTab.value = q.type;
  if (typeof q.channel === "string") filterChannel.value = q.channel;
  if (typeof q.topics === "string")
    filterTopicIds.value = q.topics.split(",").filter(Boolean);
  if (typeof q.ref === "string") filterReferences.value = q.ref;
  if (typeof q.refLabel === "string") refLabel.value = q.refLabel;
  if (typeof q.sort === "string") sortBy.value = q.sort;
  const from = typeof q.from === "string" ? new Date(q.from) : null;
  const to = typeof q.to === "string" ? new Date(q.to) : null;
  if (from && !isNaN(from.getTime())) {
    filterDates.value = [from, to && !isNaN(to.getTime()) ? to : null];
  }
}

// Filter in URL-Query spiegeln (replace: keine History-Einträge, teilbar/deep-link)
function syncQueryToUrl() {
  router.replace({ query: buildQuery() }).catch(() => {});
}

function applyFilters() {
  syncQueryToUrl();
  loadPages();
}

function onSearch() {
  if (searchDebounce) clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => applyFilters(), 350);
}

function setActiveTab(type: string) {
  activeTab.value = type;
  if (selectedPage.value) goBackToOverview();
  applyFilters();
}

function clearSearch() {
  searchQuery.value = "";
  applyFilters();
}
function clearChannel() {
  filterChannel.value = "";
  applyFilters();
}
function clearDates() {
  filterDates.value = null; // Watcher triggert applyFilters
}
function clearFilters() {
  searchQuery.value = "";
  filterChannel.value = "";
  filterTopicIds.value = [];
  filterReferences.value = "";
  refLabel.value = "";
  sortBy.value = "updated_desc";
  if (filterDates.value?.[0]) {
    filterDates.value = null; // Watcher lädt neu
  } else {
    applyFilters();
  }
}
function clearReferences() {
  filterReferences.value = "";
  refLabel.value = "";
  applyFilters();
}
// Ebene 3: Backlink-Filter setzen → Discovery zeigt nur Artikel, die auf slug verlinken
function setReferenceFilter(slug: string, label: string) {
  filterReferences.value = slug;
  refLabel.value = label;
  activeTab.value = "summary";
  selectedPage.value = null;
  selectedSlug.value = "";
  editing.value = false;
  router.replace({ path: base.value, query: buildQuery() }).catch(() => {});
  loadPages();
}

// ---- Navigation ----

function selectPage(p: any) {
  selectedPage.value = p;
  selectedSlug.value = p.slug;
  showFacets.value = false;
  editing.value = false;
  showRevisions.value = false;
  pushSlug(p.slug);
}

function pushSlug(slug: string) {
  router
    .push({ path: `${base.value}/${encodeURIComponent(slug)}`, query: route.query })
    .catch(() => {});
}

function goBackToOverview() {
  selectedPage.value = null;
  selectedSlug.value = "";
  router.push({ path: base.value, query: route.query }).catch(() => {});
}

async function loadPageBySlug(slug: string) {
  if (!workspaceId.value) return;
  try {
    const res = await axios.get(
      `/api/v1/wiki/${workspaceId.value}/pages/${encodeURIComponent(slug)}`,
    );
    if (res.data.page) {
      selectedPage.value = res.data.page;
      selectedSlug.value = slug;
      editing.value = false;
      showRevisions.value = false;
    }
  } catch {
    /* ignore */
  }
}

async function navigateToSlug(slug: string) {
  await loadPageBySlug(slug);
  pushSlug(slug);
}

// ---- Ebene 4: Bearbeiten + Historie ----

function startEdit() {
  if (!selectedPage.value) return;
  editTitle.value = selectedPage.value.title || "";
  editSummary.value = selectedPage.value.summary || "";
  editContent.value = selectedPage.value.content || "";
  editing.value = true;
}
function cancelEdit() {
  editing.value = false;
}
async function saveEdit() {
  if (!selectedPage.value) return;
  saving.value = true;
  try {
    const res = await axios.put(
      `/api/v1/wiki/${workspaceId.value}/pages/${encodeURIComponent(selectedSlug.value)}`,
      {
        title: editTitle.value,
        summary: editSummary.value,
        content: editContent.value,
      },
    );
    if (res.data.page) selectedPage.value = res.data.page;
    editing.value = false;
    // Trefferliste aktualisieren (Titel/Reihenfolge kann sich ändern)
    loadPages();
  } catch (e: any) {
    alert("Speichern fehlgeschlagen: " + (e.response?.data?.error || e.message));
  } finally {
    saving.value = false;
  }
}
// Markdown-Link an der Cursor-Position einfügen (wrappt Auswahl).
function insertLink() {
  const ta = editTextarea.value;
  if (!ta) return;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const sel = editContent.value.slice(start, end) || "Linktext";
  const snippet = `[${sel}](https://)`;
  editContent.value =
    editContent.value.slice(0, start) + snippet + editContent.value.slice(end);
  // Cursor in die URL-Klammer setzen
  const urlPos = start + sel.length + 3;
  requestAnimationFrame(() => {
    ta.focus();
    ta.setSelectionRange(urlPos, urlPos + 8);
  });
}

async function openRevisions() {
  showRevisions.value = true;
  try {
    const res = await axios.get(
      `/api/v1/wiki/${workspaceId.value}/pages/${encodeURIComponent(selectedSlug.value)}/revisions`,
    );
    revisions.value = res.data.revisions || [];
  } catch {
    revisions.value = [];
  }
}
async function restoreRevision(rev: any) {
  restoringId.value = rev.id;
  try {
    const res = await axios.post(
      `/api/v1/wiki/${workspaceId.value}/pages/${encodeURIComponent(selectedSlug.value)}/revisions/${rev.id}/restore`,
    );
    if (res.data.page) selectedPage.value = res.data.page;
    showRevisions.value = false;
    editing.value = false;
    loadPages();
  } catch (e: any) {
    alert("Wiederherstellen fehlgeschlagen: " + (e.response?.data?.error || e.message));
  } finally {
    restoringId.value = null;
  }
}
function formatDateTime(d: string) {
  return new Date(d).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Klicks auf interne Wiki-Links im Artikeltext abfangen (kein Full-Reload)
function onBodyClick(e: MouseEvent) {
  const target = (e.target as HTMLElement)?.closest("a.wiki-link");
  if (!target) return;
  const slug = target.getAttribute("data-slug");
  if (slug) {
    e.preventDefault();
    navigateToSlug(decodeURIComponent(slug));
  }
}

// ---- Rendering ----

const renderedContent = computed(() => {
  if (!selectedPage.value?.content) return "";
  return renderWikiContent(selectedPage.value.content);
});

function renderWikiContent(content: string): string {
  let html = content.replace(
    /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
    (_match: string, slug: string, text?: string) => {
      const label = text || slug.replace(/^.*\//, "").replace(/-/g, " ");
      const encoded = encodeURIComponent(slug);
      return `<a href="${base.value}/${encoded}" data-slug="${encoded}" class="wiki-link">${label}</a>`;
    },
  );

  // Externe Markdown-Links [Text](https://…) → echtes <a target=_blank> (Ebene 4)
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    (_m: string, label: string, url: string) =>
      `<a href="${url}" target="_blank" rel="noopener noreferrer" class="ext-link">${label} ↗</a>`,
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

/* ---- Rail ---- */
.wiki-rail {
  width: 300px;
  min-width: 300px;
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  background: var(--color-bg);
  overflow-y: auto;
}
.rail-search {
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

.rail-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 0.6rem 0.75rem;
  border: none;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg-secondary);
  color: var(--color-text);
  font-size: 0.85rem;
  font-family: inherit;
  cursor: pointer;
}

.rail-facets {
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  border-bottom: 1px solid var(--color-border);
}
.facet-group {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.facet-label {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--color-text-secondary);
  font-weight: 600;
}
.type-facets {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.type-facet {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  color: var(--color-text-secondary);
  font-size: 0.85rem;
  cursor: pointer;
  font-family: inherit;
}
.type-facet:hover {
  background: var(--color-bg-secondary);
}
.type-facet.active {
  border-color: var(--color-primary);
  color: var(--color-primary);
  font-weight: 600;
}
.topic-facets {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}
.topic-facet {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.25rem 0.55rem;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: var(--color-bg);
  color: var(--color-text);
  font-size: 0.78rem;
  cursor: pointer;
  font-family: inherit;
}
.topic-facet:hover {
  border-color: var(--color-primary);
}
.topic-facet.active {
  background: var(--color-primary);
  color: #fff;
  border-color: var(--color-primary);
}
.cnt {
  font-size: 0.7rem;
  padding: 0.1rem 0.4rem;
  border-radius: 8px;
  background: var(--color-bg-secondary);
  color: var(--color-text-secondary);
}
.facet-select {
  width: 100%;
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  color: var(--color-text);
  font-size: 0.85rem;
}
.facet-datepicker {
  width: 100%;
}
.facet-datepicker :deep(input) {
  padding: 0.4rem 0.6rem;
  font-size: 0.85rem;
  border-radius: 6px;
  width: 100%;
}
.btn-clear {
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg-secondary);
  color: var(--color-text);
  font-size: 0.8rem;
  cursor: pointer;
  font-family: inherit;
}

.rail-results {
  flex: 1;
  padding: 0.4rem;
}
.rail-results-head {
  font-size: 0.72rem;
  color: var(--color-text-secondary);
  padding: 0.4rem 0.5rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.rail-result {
  padding: 0.5rem;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.82rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rail-result:hover {
  background: var(--color-bg-secondary);
}
.rail-result.active {
  background: var(--color-sidebar-active);
  color: #fff;
}

/* ---- Main / Discovery ---- */
.wiki-main {
  flex: 1;
  overflow-y: auto;
  padding: 1.5rem 2rem;
  background: var(--color-content-bg);
}
.discovery-head {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1.25rem;
}
.result-count {
  font-size: 1rem;
  color: var(--color-text-secondary);
}
.result-count strong {
  color: var(--color-text);
  font-size: 1.2rem;
}
.active-chips {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.2rem 0.55rem;
  border-radius: 14px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  font-size: 0.8rem;
}
.chip button {
  border: none;
  background: none;
  color: var(--color-text-secondary);
  cursor: pointer;
  font-size: 0.75rem;
  padding: 0;
  line-height: 1;
}
.chip button:hover {
  color: var(--color-text);
}

.stats-band {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 1rem;
  margin-bottom: 1.5rem;
}
.stat-card {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 1.25rem;
  text-align: center;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  font-family: inherit;
}
.stat-card:disabled {
  cursor: default;
}
.stat-card:not(:disabled):hover {
  border-color: var(--color-primary);
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

.result-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 1rem;
}
.result-card {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 1rem;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  transition:
    border-color 0.12s,
    transform 0.12s;
}
.result-card:hover {
  border-color: var(--color-primary);
  transform: translateY(-2px);
}
.card-type {
  font-size: 0.72rem;
  font-weight: 600;
  align-self: flex-start;
  padding: 0.1rem 0.45rem;
  border-radius: 4px;
}
.card-type.summary {
  background: #e8f4fd;
  color: #0052d9;
}
.card-type.entity {
  background: #e8f8ee;
  color: #2ba471;
}
.card-type.concept {
  background: #fef3e2;
  color: #e37318;
}
.card-title {
  font-size: 0.95rem;
  font-weight: 600;
  line-height: 1.3;
  margin: 0;
}
.card-summary {
  font-size: 0.82rem;
  color: var(--color-text-secondary);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin: 0;
}
.card-meta {
  display: flex;
  gap: 0.6rem;
  font-size: 0.72rem;
  color: var(--color-text-secondary);
  margin-top: auto;
}

.list-status {
  padding: 2rem 1rem;
  text-align: center;
  color: var(--color-text-secondary);
  font-size: 0.9rem;
}
.list-status.empty {
  padding: 3rem 1rem;
}
.reader-actions {
  margin-top: 1rem;
}

/* ---- Reader ---- */
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

/* Ebene 4: Edit / Historie / Lock / externe Links */
.reader-actions-bar {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.6rem;
}
.btn-mini {
  padding: 0.3rem 0.6rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  color: var(--color-text);
  font-size: 0.8rem;
  cursor: pointer;
  font-family: inherit;
}
.btn-mini:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}
.btn-mini:disabled {
  opacity: 0.5;
  cursor: default;
}
.lock-badge {
  padding: 0.1rem 0.45rem;
  border-radius: 10px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  font-size: 0.72rem;
}
.reader-edit {
  max-width: 800px;
  display: flex;
  flex-direction: column;
}
.edit-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text-secondary);
  margin: 0.6rem 0 0.2rem;
}
.edit-input {
  padding: 0.5rem 0.7rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  color: var(--color-text);
  font-size: 0.9rem;
  font-family: inherit;
}
.edit-toolbar {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin: 0.3rem 0;
}
.edit-hint {
  font-size: 0.72rem;
  color: var(--color-text-secondary);
}
.edit-textarea {
  width: 100%;
  padding: 0.7rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  color: var(--color-text);
  font-family: ui-monospace, monospace;
  font-size: 0.85rem;
  line-height: 1.6;
  resize: vertical;
}
.edit-actions {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
  margin-top: 0.75rem;
}
.reader-body :deep(.ext-link) {
  color: var(--color-primary);
}
.rev-list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  max-height: 320px;
  overflow-y: auto;
}
.rev-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.5rem 0.6rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
}
.rev-info {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
}
.rev-ver {
  font-weight: 600;
  font-size: 0.85rem;
}
.rev-date {
  font-size: 0.78rem;
  color: var(--color-text-secondary);
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

/* ---- Responsive: Rail über Vollbreite, dann Detail ---- */
@media (max-width: 768px) {
  .wiki-layout {
    display: block;
    overflow: visible;
  }
  .wiki-rail {
    width: 100%;
    min-width: 0;
    border-right: none;
  }
  .wiki-main {
    padding: 1rem 1.1rem;
  }
  /* Discovery: Rail (Filter) oben, Grid darunter — beide sichtbar */
  .wiki-layout:not(.reader) .wiki-main {
    display: block;
  }
  /* Reader: nur der Artikel, Rail ausblenden */
  .wiki-layout.reader .wiki-rail {
    display: none;
  }
  .reader-header h2 {
    font-size: 1.35rem;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  .reader-body {
    overflow-wrap: anywhere;
  }
  .dialog,
  .dialog-wide {
    min-width: 0;
    width: calc(100vw - 2rem);
    max-width: calc(100vw - 2rem);
  }
}
</style>
