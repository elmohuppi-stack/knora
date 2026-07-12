<template>
  <main class="main-content">
    <div class="header">
      <div class="header-left">
        <router-link :to="'/documents/' + workspaceId" class="back-link"
          >← Zurück zur Liste</router-link
        >
        <h3>{{ doc?.title || "Lädt..." }}</h3>
      </div>
      <div class="header-actions" v-if="doc">
        <button
          class="btn-primary"
          @click="generateWiki"
          :disabled="generating"
        >
          {{ generating ? "⏳ Generiere..." : "📖 Wiki-Artikel generieren" }}
        </button>
        <span v-if="genResult" class="success" style="margin-left: 0.5rem">{{
          genResult
        }}</span>
      </div>
    </div>

    <div v-if="!doc" class="content">
      <p class="empty">Lade Dokument...</p>
    </div>

    <template v-else>
      <!-- YouTube Embed -->
      <div class="video-section" v-if="youtubeId">
        <iframe :src="`https://www.youtube-nocookie.com/embed/${youtubeId}`" title="YouTube" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen class="video-iframe"></iframe>
      </div>

      <!-- Tabs -->
      <div class="tabs-bar">
        <button :class="['tab', { active: activeTab === 'transcript' }]" @click="activeTab = 'transcript'">📝 Transkript</button>
        <button :class="['tab', { active: activeTab === 'wiki' }]" @click="activeTab = 'wiki'">📖 Wiki-Artikel ({{ wikiPages.length }})</button>
        <button :class="['tab', { active: activeTab === 'activity' }]" @click="activeTab = 'activity'; loadActivityLog()">📋 Aktivitäten</button>
      </div>

      <!-- Tab: Transkript -->
      <div v-if="activeTab === 'transcript'" class="content">
        <div class="meta-grid">
          <div class="meta-card"><strong>Titel</strong><span>{{ doc.title }}</span></div>
          <div class="meta-card"><strong>Typ</strong><span class="type-badge">{{ doc.type }}</span></div>
          <div class="meta-card"><strong>Status</strong><span :class="['status', doc.parse_status]">{{ statusLabel(doc.parse_status) }}</span></div>
          <div class="meta-card" v-if="doc.source_url"><strong>Quelle</strong><a :href="doc.source_url" target="_blank">{{ doc.source_url.slice(0, 50) }}…</a></div>
          <div class="meta-card"><strong>Chunks</strong><span>{{ doc.chunk_count || "-" }}</span></div>
          <div class="meta-card"><strong>Hochgeladen</strong><span>{{ formatDate(doc.created_at) }}</span></div>
        </div>
        <div class="transcript-box" v-if="doc.content">
          <pre>{{ doc.content }}</pre>
        </div>
        <p v-else class="empty">(Kein Inhalt)</p>
      </div>

      <!-- Tab: Wiki-Artikel -->
      <div v-if="activeTab === 'wiki'" class="content">
        <div v-if="wikiPages.length === 0" class="empty">
          <p>Noch keine Wiki-Artikel. Klicke auf "📖 Wiki generieren" um Artikel zu erstellen.</p>
        </div>
        <div v-else class="wiki-tab-list">
          <div v-for="wp in wikiPages" :key="wp.id" class="wiki-tab-card">
            <router-link :to="`/wiki/${workspaceId}/${encodeURIComponent(wp.slug)}`" class="wiki-tab-link">
              <span class="wiki-type-icon">{{ wp.page_type === 'vollstaendig' ? '📖' : '📄' }}</span>
              <div>
                <strong>{{ wp.title }}</strong>
                <span class="wiki-type-label">{{ wp.page_type === 'vollstaendig' ? 'Vollständiger Artikel' : 'Zusammenfassung' }}</span>
              </div>
              <span class="wiki-arrow">→</span>
            </router-link>
          </div>
        </div>
      </div>

      <!-- Tab: Aktivitäten -->
      <div v-if="activeTab === 'activity'" class="content">
        <div v-if="loadingLogs" class="empty">Lade Aktivitäten...</div>
        <div v-else-if="activityLogs.length === 0" class="empty">
          <p>Keine Aktivitäten zu diesem Dokument gefunden.</p>
        </div>
        <div v-else class="log-list">
          <div v-for="log in activityLogs" :key="log.id" class="log-entry" :class="log.status">
            <div class="log-header">
              <span class="log-action">{{ log.action === 'youtube_import' ? '▶️ YouTube-Import' : '📖 Wiki-Generierung' }}</span>
              <span class="log-status" :class="log.status">{{ log.status === 'completed' ? '✅' : log.status === 'failed' ? '❌' : '🔄' }} {{ statusLabel(log.status) }}</span>
              <span class="log-time">{{ formatDateTime(log.created_at) }}</span>
            </div>
            <div class="log-message">{{ log.message }}</div>
            <div class="log-meta" v-if="log.duration_ms">⏱️ {{ (log.duration_ms / 1000).toFixed(1) }}s</div>
            <div class="log-details" v-if="log.details && Object.keys(log.details).length">
              <details>
                <summary>Details</summary>
                <pre>{{ JSON.stringify(log.details, null, 2) }}</pre>
              </details>
            </div>
          </div>
        </div>
      </div>
    </template>
  </main>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useAuthStore } from "../../stores/auth";
import axios from "axios";

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();
const workspaceId = route.params.workspaceId as string;
const documentId = route.params.documentId as string;

const doc = ref<any>(null);
const wikiPages = ref<any[]>([]);
const generating = ref(false);
const genResult = ref("");
const activeTab = ref("transcript");
const activityLogs = ref<any[]>([]);
const loadingLogs = ref(false);

const youtubeId = computed(() => {
  if (!doc.value?.source_url) return null;
  const match = doc.value.source_url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
  );
  return match?.[1] || null;
});

onMounted(async () => {
  if (!auth.isAuthenticated) {
    router.push("/login");
    return;
  }
  await Promise.all([loadDoc(), loadWikiPages()]);
});

async function loadDoc() {
  try {
    const res = await axios.get(`/api/v1/documents/detail/${documentId}`);
    doc.value = res.data.document;
  } catch (e: any) {
    console.error("Failed to load document", e);
  }
}

async function loadWikiPages() {
  try {
    const res = await axios.get(`/api/v1/wiki/${workspaceId}/pages`, { params: { source_document_id: documentId } });
    wikiPages.value = res.data.pages || [];
  } catch (e: any) { console.error("Failed to load wiki pages", e); }
}

async function loadActivityLog() {
  loadingLogs.value = true;
  try {
    const res = await axios.get("/api/v1/admin/activity-logs", { params: { document_id: documentId, limit: 20 } });
    activityLogs.value = res.data.logs || [];
  } catch (e: any) { console.error("Failed to load activity logs", e); }
  finally { loadingLogs.value = false; }
}

async function generateWiki() {
  generating.value = true;
  genResult.value = "";
  try {
    const res = await axios.post(
      `/api/v1/wiki/${workspaceId}/generate/${documentId}`,
    );
    const pages = res.data.pages || [];
    if (pages.length > 0) {
      genResult.value = `✅ ${pages.length} Artikel erstellt`;
    } else {
      genResult.value = "⚠️ Keine Artikel generiert";
    }
  } catch (e: any) {
    genResult.value = "❌ " + (e.response?.data?.error || e.message);
  } finally {
    generating.value = false;
  }
}

function statusLabel(s: string) {
  const map: Record<string, string> = {
    pending: "Ausstehend",
    processing: "Verarbeite...",
    completed: "✅ Fertig",
    failed: "❌ Fehler",
  };
  return map[s] || s;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function formatDateTime(dateStr: string) {
  return new Date(dateStr).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
</script>

<style scoped>
.main-content {
  flex: 1;
  overflow-y: auto;
}
.header {
  padding: 1rem 1.5rem;
  border-bottom: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}
.header-left {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
}
.header-left h3 {
  font-size: 1.1rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.back-link {
  font-size: 0.875rem;
  color: var(--color-primary);
  text-decoration: none;
  white-space: nowrap;
}
.content {
  padding: 1.5rem;
}
.empty {
  color: var(--color-text-secondary);
  text-align: center;
  padding: 2rem;
}

/* Video */
.video-section { padding: 0; background: #000; }
.video-iframe { width: 100%; max-width: 800px; aspect-ratio: 16 / 9; display: block; margin: 0 auto; }

/* Tabs */
.tabs-bar { display: flex; gap: 0; border-bottom: 1px solid var(--color-border); background: var(--color-bg-secondary); }
.tabs-bar .tab { padding: 0.6rem 1.25rem; border: none; background: none; font-size: 0.85rem; cursor: pointer; color: var(--color-text-secondary); border-bottom: 2px solid transparent; }
.tabs-bar .tab.active { color: var(--color-text); font-weight: 600; border-bottom-color: var(--color-primary); background: white; }
.tabs-bar .tab:hover:not(.active) { color: var(--color-text); }

/* Wiki-Artikel Tab */
.wiki-tab-list { display: flex; flex-direction: column; gap: 0.5rem; }
.wiki-tab-card { border: 1px solid var(--color-border); border-radius: 8px; }
.wiki-tab-link { display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1rem; text-decoration: none; color: var(--color-text); font-size: 0.9rem; }
.wiki-tab-link:hover { background: var(--color-bg-secondary); border-radius: 8px; }
.wiki-type-icon { font-size: 1.3rem; }
.wiki-type-label { display: block; font-size: 0.75rem; color: var(--color-text-secondary); margin-top: 0.1rem; }
.wiki-arrow { margin-left: auto; color: var(--color-text-secondary); }

/* Aktivitäten Tab */
.log-list { display: flex; flex-direction: column; gap: 0.5rem; }
.log-entry { border: 1px solid var(--color-border); border-radius: 8px; padding: 0.75rem 1rem; background: white; }
.log-entry.failed { border-left: 3px solid #ef4444; }
.log-entry.completed { border-left: 3px solid #22c55e; }
.log-entry.started { border-left: 3px solid #f59e0b; }
.log-header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.25rem; }
.log-action { font-weight: 600; font-size: 0.85rem; }
.log-status { font-size: 0.75rem; padding: 0.1rem 0.4rem; border-radius: 4px; background: var(--color-bg-secondary); }
.log-status.failed { color: #ef4444; }
.log-status.completed { color: #22c55e; }
.log-time { font-size: 0.75rem; color: var(--color-text-secondary); margin-left: auto; }
.log-message { font-size: 0.85rem; color: var(--color-text); margin-bottom: 0.2rem; }
.log-meta { font-size: 0.75rem; color: var(--color-text-secondary); }
.log-details { margin-top: 0.3rem; }
.log-details summary { font-size: 0.75rem; color: var(--color-text-secondary); cursor: pointer; }
.log-details pre { font-size: 0.75rem; background: var(--color-bg-secondary); padding: 0.5rem; border-radius: 4px; overflow-x: auto; margin-top: 0.3rem; }

/* Metadaten */
.meta-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 0.75rem;
  margin-bottom: 1rem;
}
.meta-card {
  background: var(--color-bg-secondary);
  border-radius: 6px;
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.meta-card strong {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}
.meta-card span,
.meta-card a {
  font-size: 0.9rem;
  word-break: break-word;
}
.meta-card a {
  color: var(--color-primary);
}

/* Wiki Links */
.wiki-links {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 1rem;
}
.wiki-link-chip {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.6rem 1rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  text-decoration: none;
  color: var(--color-text);
  font-size: 0.9rem;
  background: white;
  transition: background 0.15s;
}
.wiki-link-chip:hover {
  background: var(--color-bg-secondary);
}
.wiki-type-badge {
  font-size: 0.7rem;
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
  background: var(--color-bg-secondary);
  color: var(--color-text-secondary);
  margin-left: auto;
}

/* Transkript */
.transcript-box {
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 1rem;
  max-height: 70vh;
  overflow-y: auto;
}
.transcript-box pre {
  white-space: pre-wrap;
  word-wrap: break-word;
  font-size: 0.85rem;
  line-height: 1.6;
  font-family: inherit;
  margin: 0;
}
</style>
