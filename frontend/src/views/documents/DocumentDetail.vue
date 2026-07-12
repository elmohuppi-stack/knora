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
        <iframe
          :src="`https://www.youtube-nocookie.com/embed/${youtubeId}`"
          title="YouTube Video"
          frameborder="0"
          allow="
            accelerometer;
            autoplay;
            clipboard-write;
            encrypted-media;
            gyroscope;
            picture-in-picture;
          "
          allowfullscreen
          class="video-iframe"
        ></iframe>
      </div>

      <!-- Metadaten -->
      <div class="content">
        <div class="meta-grid">
          <div class="meta-card">
            <strong>Titel</strong>
            <span>{{ doc.title }}</span>
          </div>
          <div class="meta-card">
            <strong>Typ</strong>
            <span class="type-badge">{{ doc.type }}</span>
          </div>
          <div class="meta-card">
            <strong>Status</strong>
            <span :class="['status', doc.parse_status]">{{
              statusLabel(doc.parse_status)
            }}</span>
          </div>
          <div class="meta-card" v-if="doc.source_url">
            <strong>Quelle</strong>
            <a :href="doc.source_url" target="_blank" rel="noopener"
              >{{ doc.source_url.slice(0, 60) }}…</a
            >
          </div>
          <div class="meta-card">
            <strong>Chunks</strong>
            <span>{{ doc.chunk_count || "-" }}</span>
          </div>
          <div class="meta-card">
            <strong>Hochgeladen</strong>
            <span>{{ formatDate(doc.created_at) }}</span>
          </div>
        </div>

        <!-- Wiki-Artikel Verweis -->
        <div v-if="wikiPages.length > 0" style="margin: 1rem 0">
          <h4>📖 Wiki-Artikel</h4>
          <div class="wiki-links">
            <router-link
              v-for="wp in wikiPages"
              :key="wp.id"
              :to="`/wiki/${workspaceId}/${encodeURIComponent(wp.slug)}`"
              class="wiki-link-chip"
            >
              {{ wp.title }}
              <span class="wiki-type-badge">{{
                wp.page_type === "vollstaendig"
                  ? "Vollständig"
                  : "Zusammenfassung"
              }}</span>
            </router-link>
          </div>
        </div>

        <!-- Transkript / Inhalt -->
        <h4 style="margin-top: 1.5rem">📝 Transkript</h4>
        <div class="transcript-box" v-if="doc.content">
          <pre>{{ doc.content }}</pre>
        </div>
        <p v-else class="empty">(Kein Inhalt)</p>
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
    const res = await axios.get(`/api/v1/wiki/${workspaceId}/pages`, {
      params: { source_document_id: documentId },
    });
    wikiPages.value = res.data.pages || [];
  } catch (e: any) {
    console.error("Failed to load wiki pages", e);
  }
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
  return new Date(dateStr).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
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
.video-section {
  padding: 1rem 1.5rem;
  background: #000;
}
.video-iframe {
  width: 100%;
  max-width: 800px;
  aspect-ratio: 16 / 9;
  display: block;
  margin: 0 auto;
  border-radius: 8px;
}

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
