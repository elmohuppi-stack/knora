<template>
  <main class="main-content">
    <div class="header">
      <div class="header-left">
        <router-link :to="'/documents/' + workspaceId" class="back-link">← Zurück zur Liste</router-link>
        <h3>{{ doc?.title || "Lädt..." }}</h3>
      </div>
      <div class="header-actions" v-if="doc">
        <button class="btn-primary" @click="generateWiki" :disabled="generating">
          {{ generating ? "⏳ Generiere..." : "📖 Wiki-Artikel generieren" }}
        </button>
        <span v-if="genResult" class="success" style="margin-left:0.5rem;">{{ genResult }}</span>
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
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
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
            <span :class="['status', doc.parse_status]">{{ statusLabel(doc.parse_status) }}</span>
          </div>
          <div class="meta-card" v-if="doc.source_url">
            <strong>Quelle</strong>
            <a :href="doc.source_url" target="_blank" rel="noopener">{{ doc.source_url.slice(0, 60) }}…</a>
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

        <!-- Transkript / Inhalt -->
        <h4 style="margin-top:1.5rem;">📝 Transkript</h4>
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
  await loadDoc();
});

async function loadDoc() {
  try {
    const res = await axios.get(`/api/v1/documents/detail/${documentId}`);
    doc.value = res.data.document;
  } catch (e: any) {
    console.error("Failed to load document", e);
  }
}

async function generateWiki() {
  generating.value = true;
  genResult.value = "";
  try {
    const res = await axios.post(`/api/v1/wiki/${workspaceId}/generate/${documentId}`);
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
