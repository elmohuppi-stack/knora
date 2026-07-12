<template>
  <main class="main-content">
    <div class="header">
      <router-link :to="'/documents/' + workspaceId" class="back-link">← Zurück zur Liste</router-link>
      <h3>{{ doc?.title || "Lädt..." }}</h3>
    </div>

    <div v-if="!doc" class="content">
      <p class="empty">Lade Dokument...</p>
    </div>

    <template v-else>
      <!-- Meta + Video Row -->
      <div class="meta-video-row">
        <div class="meta-info">
          <div class="meta-line"><strong>Kanal:</strong> {{ channelName }}</div>
          <div class="meta-line"><strong>Datum:</strong> {{ formatDate(doc.created_at) }}</div>
          <div class="meta-line"><strong>Typ:</strong> <span class="type-badge">{{ doc.type }}</span></div>
          <div class="meta-line" v-if="doc.source_url"><strong>Quelle:</strong> <a :href="doc.source_url" target="_blank">{{ doc.source_url.slice(0, 50) }}…</a></div>
          <div class="desc-preview" v-if="descPreview" @click="showFullDesc = !showFullDesc">
            <strong>Beschreibung:</strong>
            <p>{{ showFullDesc ? fullDescription : descPreview }}</p>
            <button class="desc-toggle">{{ showFullDesc ? "▲ weniger" : "▼ mehr" }}</button>
          </div>
        </div>
        <div class="meta-video" v-if="youtubeId">
          <iframe :src="'https://www.youtube-nocookie.com/embed/' + youtubeId" title="YouTube" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen class="video-thumb"></iframe>
        </div>
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
        <div v-if="wikiPages.length === 0">
          <div class="empty"><p>Noch keine Wiki-Artikel zu diesem Dokument.</p></div>
          <div style="text-align:center;padding:1rem;">
            <button class="btn-primary btn-lg" @click="generateWiki" :disabled="generating">{{ generating ? "⏳ Generiere..." : "📖 Wiki-Artikel generieren" }}</button>
            <p v-if="genResult" class="gen-feedback">{{ genResult }}</p>
          </div>
        </div>
        <div v-else class="wiki-tab-list">
          <div v-for="wp in wikiPages" :key="wp.id" class="wiki-tab-card">
            <router-link :to="'/wiki/' + workspaceId + '/' + encodeURIComponent(wp.slug)" class="wiki-tab-link">
              <span class="wiki-type-icon">{{ wp.page_type === 'vollstaendig' ? '📖' : '📄' }}</span>
              <div>
                <strong>{{ wp.title }}</strong>
                <span class="wiki-type-label">{{ wp.page_type === 'vollstaendig' ? 'Vollständiger Artikel' : 'Zusammenfassung' }}</span>
              </div>
              <span class="wiki-arrow">→</span>
            </router-link>
          </div>
          <div style="text-align:center;margin-top:0.75rem;">
            <button class="btn-secondary" @click="generateWiki" :disabled="generating">{{ generating ? "⏳ Generiere..." : "🔄 Neu generieren" }}</button>
          </div>
        </div>
      </div>

      <!-- Tab: Aktivitäten -->
      <div v-if="activeTab === 'activity'" class="content">
        <div class="activity-toolbar">
          <span class="live-badge" :class="{ active: liveActive }">
            <span class="live-dot"></span> Live
          </span>
          <span class="log-count" v-if="activityLogs.length">{{ activityLogs.length }} Einträge</span>
        </div>
        <div v-if="loadingLogs && activityLogs.length === 0" class="empty">Lade Aktivitäten...</div>
        <div v-else-if="activityLogs.length === 0" class="empty">
          <p>Keine Aktivitäten zu diesem Dokument. Diese erscheinen hier beim YouTube-Import und bei der Wiki-Generierung.</p>
        </div>
        <div v-else ref="logContainer" class="log-list">
          <div v-for="log in activityLogs" :key="log.id" class="log-entry" :class="log.status">
            <div class="log-header">
              <span class="log-action-icon">{{ log.action === 'youtube_import' ? '▶️' : '📖' }}</span>
              <span class="log-action">{{ log.action === 'youtube_import' ? 'YouTube-Import' : 'Wiki-Generierung' }}</span>
              <span class="log-status-dot" :class="log.status"></span>
              <span class="log-time">{{ formatDateTime(log.created_at) }}</span>
            </div>
            <div class="log-body">
              <div class="log-message">{{ log.message }}</div>
              <div class="log-meta-row">
                <span class="log-status-label" :class="log.status">{{ log.status === 'completed' ? '✅ Erfolgreich' : log.status === 'failed' ? '❌ Fehlgeschlagen' : '🔄 Läuft' }}</span>
                <span v-if="log.duration_ms">⏱️ {{ (log.duration_ms / 1000).toFixed(1) }}s</span>
              </div>
            </div>
            <div class="log-details" v-if="log.details && Object.keys(log.details).length">
              <details>
                <summary>Details anzeigen</summary>
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
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
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
const showFullDesc = ref(false);
let liveRefresh: ReturnType<typeof setInterval> | null = null;
const liveActive = ref(false);

const youtubeId = computed(() => {
  if (!doc.value?.source_url) return null;
  const match = doc.value.source_url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
  );
  return match?.[1] || null;
});

const channelName = computed(() => {
  const c = doc.value?.content || "";
  const match = c.match(/\*\*Kanal\*\*:\s*(.+)/);
  return match?.[1]?.trim() || "-";
});

const fullDescription = computed(() => {
  const c = doc.value?.content || "";
  const match = c.match(/\*\*Beschreibung\*\*:\s*(.+?)(?=\n##|$)/s);
  return match?.[1]?.trim() || "";
});

const descPreview = computed(() => {
  const d = fullDescription.value;
  return d ? d.slice(0, 150) + (d.length > 150 ? "..." : "") : "";
});

onMounted(async () => {
  if (!auth.isAuthenticated) {
    router.push("/login");
    return;
  }
  await Promise.all([loadDoc(), loadWikiPages()]);
  // Live-Refresh für Aktivitäten
  watch(activeTab, (tab) => {
    if (tab === "activity") {
      loadActivityLog();
      startLiveRefresh();
    } else {
      stopLiveRefresh();
    }
  });
});

onUnmounted(() => stopLiveRefresh());

function startLiveRefresh() {
  stopLiveRefresh();
  liveActive.value = true;
  liveRefresh = setInterval(() => loadActivityLog(true), 2500);
}

function stopLiveRefresh() {
  liveActive.value = false;
  if (liveRefresh) {
    clearInterval(liveRefresh);
    liveRefresh = null;
  }
}

async function loadDoc() {
  try {
    const res = await axios.get("/api/v1/documents/detail/" + documentId);
    doc.value = res.data.document;
  } catch (e: any) {
    console.error("Failed to load document", e);
  }
}

async function loadWikiPages() {
  try {
    const res = await axios.get("/api/v1/wiki/" + workspaceId + "/pages", { params: { source_document_id: documentId } });
    wikiPages.value = res.data.pages || [];
  } catch (e: any) { console.error("Failed to load wiki pages", e); }
}

const logContainer = ref<HTMLElement | null>(null);

async function loadActivityLog(silent = false) {
  if (!silent) loadingLogs.value = true;
  try {
    const res = await axios.get("/api/v1/admin/activity-logs", { params: { document_id: documentId, limit: 20 } });
    const logs = res.data.logs || [];
    activityLogs.value = logs;
  } catch (e: any) { console.error("Failed to load activity logs", e); }
  finally { loadingLogs.value = false; }
}

async function generateWiki() {
  generating.value = true;
  genResult.value = "";
  try {
    const res = await axios.post(
      "/api/v1/wiki/" + workspaceId + "/generate/" + documentId,
    );
    const pages = res.data.pages || [];
    if (pages.length > 0) {
      genResult.value = "✅ " + pages.length + " Artikel erstellt";
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
.main-content { flex: 1; overflow-y: auto; }
.header { padding: .75rem 1.5rem; border-bottom: 1px solid var(--color-border); display: flex; align-items: center; gap: 1rem; }
.header h3 { font-size: 1.1rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; margin: 0; }
.back-link { font-size: .875rem; color: var(--color-primary); text-decoration: none; white-space: nowrap; }
.content { padding: 1.5rem; }
.empty { color: var(--color-text-secondary); text-align: center; padding: 2rem; }

/* Meta + Video Row */
.meta-video-row { display: flex; gap: 1.5rem; padding: 1rem 1.5rem; background: var(--color-bg-secondary); border-bottom: 1px solid var(--color-border); align-items: flex-start; }
.meta-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: .35rem; }
.meta-line { font-size: .85rem; color: var(--color-text); }
.meta-line strong { color: var(--color-text-secondary); margin-right: .35rem; }
.meta-line a { color: var(--color-primary); word-break: break-all; }
.desc-preview { cursor: pointer; }
.desc-preview p { font-size: .82rem; color: var(--color-text-secondary); margin: .25rem 0; line-height: 1.5; }
.desc-toggle { font-size: .75rem; color: var(--color-primary); border: none; background: none; cursor: pointer; padding: 0; }
.meta-video { flex-shrink: 0; width: 280px; }
.video-thumb { width: 100%; aspect-ratio: 16/9; border-radius: 8px; display: block; }
.type-badge { display: inline-block; font-size: .75rem; padding: .15rem .5rem; border-radius: 4px; background: var(--color-border); color: var(--color-text-secondary); }

/* Tabs */
.tabs-bar { display: flex; gap: 0; border-bottom: 1px solid var(--color-border); background: var(--color-bg-secondary); }
.tabs-bar .tab { padding: .6rem 1.25rem; border: none; background: none; font-size: .85rem; cursor: pointer; color: var(--color-text-secondary); border-bottom: 2px solid transparent; transition: all .15s; }
.tabs-bar .tab.active { color: var(--color-text); font-weight: 600; border-bottom-color: var(--color-primary); background: white; }
.tabs-bar .tab:hover:not(.active) { color: var(--color-text); }

/* Wiki Tab */
.wiki-tab-list { display: flex; flex-direction: column; gap: .5rem; }
.wiki-tab-card { border: 1px solid var(--color-border); border-radius: 8px; }
.wiki-tab-link { display: flex; align-items: center; gap: .75rem; padding: .75rem 1rem; text-decoration: none; color: var(--color-text); font-size: .9rem; }
.wiki-tab-link:hover { background: var(--color-bg-secondary); border-radius: 8px; }
.wiki-type-icon { font-size: 1.3rem; }
.wiki-type-label { display: block; font-size: .75rem; color: var(--color-text-secondary); margin-top: .1rem; }
.wiki-arrow { margin-left: auto; color: var(--color-text-secondary); }
.gen-feedback { margin-top: .5rem; font-size: .85rem; color: var(--color-primary); }
.btn-lg { padding: .65rem 1.5rem; font-size: .95rem; }

/* Activity Log */
.activity-toolbar { display: flex; align-items: center; gap: .75rem; margin-bottom: .75rem; }
.live-badge { display: inline-flex; align-items: center; gap: .4rem; font-size: .75rem; font-weight: 600; color: var(--color-text-secondary); padding: .2rem .6rem; border-radius: 20px; background: var(--color-bg-secondary); }
.live-badge.active { color: #16a34a; background: #dcfce7; }
.live-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--color-text-secondary); }
.live-badge.active .live-dot { background: #16a34a; animation: pulse-dot 1.5s ease-in-out infinite; }
@keyframes pulse-dot { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }
.log-count { font-size: .75rem; color: var(--color-text-secondary); }
.log-list { display: flex; flex-direction: column; gap: .5rem; }
.log-entry { border: 1px solid var(--color-border); border-radius: 8px; padding: .75rem 1rem; background: white; }
.log-entry.failed { border-left: 3px solid #ef4444; }
.log-entry.completed { border-left: 3px solid #22c55e; }
.log-entry.started { border-left: 3px solid #f59e0b; }
.log-header { display: flex; align-items: center; gap: .5rem; margin-bottom: .25rem; }
.log-action-icon { font-size: 1rem; }
.log-action { font-weight: 600; font-size: .85rem; }
.log-status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.log-status-dot.completed { background: #22c55e; }
.log-status-dot.failed { background: #ef4444; }
.log-status-dot.started { background: #f59e0b; }
.log-time { font-size: .75rem; color: var(--color-text-secondary); margin-left: auto; white-space: nowrap; }
.log-body { }
.log-message { font-size: .85rem; color: var(--color-text); margin-bottom: .2rem; }
.log-meta-row { display: flex; gap: 1rem; font-size: .75rem; color: var(--color-text-secondary); }
.log-status-label { }
.log-status-label.failed { color: #ef4444; }
.log-status-label.completed { color: #22c55e; }
.log-details { margin-top: .3rem; }
.log-details summary { font-size: .75rem; color: var(--color-text-secondary); cursor: pointer; }
.log-details pre { font-size: .75rem; background: var(--color-bg-secondary); padding: .5rem; border-radius: 4px; overflow-x: auto; margin-top: .3rem; }

/* Meta Grid (Transcript Tab) */
.meta-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: .75rem; margin-bottom: 1rem; }
.meta-card { background: var(--color-bg-secondary); border-radius: 6px; padding: .75rem; display: flex; flex-direction: column; gap: .2rem; }
.meta-card strong { font-size: .75rem; color: var(--color-text-secondary); }
.meta-card span, .meta-card a { font-size: .9rem; word-break: break-word; }
.meta-card a { color: var(--color-primary); }

/* Transcript */
.transcript-box { background: var(--color-bg-secondary); border: 1px solid var(--color-border); border-radius: 8px; padding: 1rem; max-height: 70vh; overflow-y: auto; }
.transcript-box pre { white-space: pre-wrap; word-wrap: break-word; font-size: .85rem; line-height: 1.6; font-family: inherit; margin: 0; }
</style>