<template>
  <div class="layout">
    <aside class="sidebar">
      <div class="sidebar-header"><h2>Wiki-Chat</h2></div>
      <nav class="sidebar-nav">
        <router-link to="/chat" class="nav-item">💬 Chat</router-link>
        <router-link to="/wiki" class="nav-item">📖 Wiki</router-link>
        <router-link to="/workspaces" class="nav-item">📁 Workspaces</router-link>
        <router-link to="/admin" class="nav-item" v-if="auth.isAdmin">⚙️ Admin</router-link>
      </nav>
      <div class="sidebar-footer">
        <span>{{ auth.userName }}</span>
        <button @click="auth.logout(); $router.push('/login')" class="logout-btn">Abmelden</button>
      </div>
    </aside>

    <main class="main-content">
      <div class="header">
        <router-link :to="'/workspaces/' + workspaceId" class="back-link">← Workspace</router-link>
        <h3>📄 Dokumente</h3>
        <div class="header-actions">
          <button class="btn-primary" @click="showUpload = true">📤 Upload</button>
          <button class="btn-primary" @click="showUrl = true">🔗 URL</button>
          <button class="btn-primary" @click="showYoutube = true">▶️ YouTube</button>
        </div>
      </div>

      <!-- Upload Area -->
      <div v-if="showUpload" class="upload-area">
        <input type="file" ref="fileInput" @change="uploadFile" accept=".pdf,.docx,.md,.txt,.html,.csv" class="file-input" />
        <p v-if="uploading">📤 Lädt hoch...</p>
        <p v-if="uploadError" class="error">{{ uploadError }}</p>
        <button class="btn-secondary" @click="showUpload = false" v-if="!uploading">Schließen</button>
      </div>

      <!-- URL Import -->
      <div v-if="showUrl" class="upload-area">
        <input v-model="urlInput" placeholder="https://..." class="url-input" />
        <button class="btn-primary" @click="importUrl" :disabled="!urlInput.trim() || importing">
          {{ importing ? '⏳ Importiere...' : 'Importieren' }}
        </button>
        <p v-if="urlError" class="error">{{ urlError }}</p>
        <button class="btn-secondary" @click="showUrl = false">Schließen</button>
      </div>

      <!-- YouTube Import -->
      <div v-if="showYoutube" class="upload-area">
        <input v-model="youtubeUrl" placeholder="https://youtube.com/watch?v=..." class="url-input" />
        <button class="btn-primary" @click="importYoutube" :disabled="!youtubeUrl.trim() || youtubing">
          {{ youtubing ? '⏳ Importiere...' : 'Importieren' }}
        </button>
        <p v-if="youtubeInfo" class="success">▶️ {{ youtubeInfo }}</p>
        <p v-if="youtubeError" class="error">{{ youtubeError }}</p>
        <button class="btn-secondary" @click="showYoutube = false; youtubeUrl = ''; youtubeError = ''; youtubeInfo = ''">Schließen</button>
      </div>

      <!-- Document List -->
      <div class="content">
        <div v-if="loading" class="loading">Lade Dokumente...</div>

        <div v-else-if="docs.length === 0" class="empty">
          <p>Noch keine Dokumente. Lade eine Datei hoch oder importiere eine URL.</p>
        </div>

        <table v-else class="table">
          <thead>
            <tr>
              <th>Titel</th><th>Typ</th><th>Chunks</th><th>Status</th><th>Hochgeladen</th><th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="doc in docs" :key="doc.id">
              <td class="doc-title">{{ doc.title }}</td>
              <td><span class="type-badge">{{ doc.type }}</span></td>
              <td>{{ doc.chunk_count || '-' }}</td>
              <td>
                <span :class="['status', doc.parse_status]">
                  {{ statusLabel(doc.parse_status) }}
                </span>
              </td>
              <td class="date">{{ formatDate(doc.created_at) }}</td>
              <td>
                <button class="btn-danger-sm" @click="deleteDoc(doc.id)">✕</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useAuthStore } from "../../stores/auth";
import axios from "axios";

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();
const workspaceId = route.params.workspaceId as string;

const docs = ref<any[]>([]);
const loading = ref(true);
const showUpload = ref(false);
const showUrl = ref(false);
const showYoutube = ref(false);
const uploading = ref(false);
const importing = ref(false);
const youtubing = ref(false);
const uploadError = ref("");
const urlError = ref("");
const youtubeError = ref("");
const youtubeInfo = ref("");
const urlInput = ref("");
const youtubeUrl = ref("");

onMounted(async () => {
  if (!auth.isAuthenticated) { router.push("/login"); return; }
  if (!workspaceId) { router.push("/workspaces"); return; }
  await loadDocs();
});

async function loadDocs() {
  try {
    const res = await axios.get(`/api/v1/documents/${workspaceId}`);
    docs.value = res.data.documents || [];
  } catch (e: any) {
    console.error("Failed to load docs", e);
  } finally {
    loading.value = false;
  }
}

async function uploadFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  uploading.value = true;
  uploadError.value = "";
  try {
    const form = new FormData();
    form.append("file", file);
    await axios.post(`/api/v1/documents/upload/${workspaceId}`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    showUpload.value = false;
    await loadDocs();
  } catch (e: any) {
    uploadError.value = e.response?.data?.error || e.message;
  } finally {
    uploading.value = false;
  }
}

async function importUrl() {
  importing.value = true;
  urlError.value = "";
  try {
    await axios.post("/api/v1/documents/import-url", {
      workspace_id: workspaceId,
      url: urlInput.value,
    });
    showUrl.value = false;
    urlInput.value = "";
    await loadDocs();
  } catch (e: any) {
    urlError.value = e.response?.data?.error || e.message;
  } finally {
    importing.value = false;
  }
}

async function importYoutube() {
  youtubing.value = true;
  youtubeError.value = "";
  youtubeInfo.value = "";
  try {
    const res = await axios.post("/api/v1/documents/import-youtube", {
      workspace_id: workspaceId,
      url: youtubeUrl.value,
    });
    youtubeInfo.value = `✅ ${res.data.document.title}`;
    if (res.data.wiki_page) {
      youtubeInfo.value += ` 📖 Wiki: "${res.data.wiki_page.title}"`;
    }
    showYoutube.value = false;
    youtubeUrl.value = "";
    await loadDocs();
  } catch (e: any) {
    youtubeError.value = e.response?.data?.error || e.message;
  } finally {
    youtubing.value = false;
  }
}

async function deleteDoc(id: string) {
  if (!confirm("Dokument löschen?")) return;
  try {
    await axios.delete(`/api/v1/documents/${id}`);
    docs.value = docs.value.filter((d: any) => d.id !== id);
  } catch {
    alert("Fehler beim Löschen");
  }
}

function statusLabel(s: string) {
  const map: Record<string, string> = { pending: "Ausstehend", processing: "Verarbeite...", completed: "✅ Fertig", failed: "❌ Fehler" };
  return map[s] || s;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}
</script>

<style scoped>
.layout { display: flex; height: 100vh; }
.sidebar { width: var(--sidebar-width); background: var(--color-bg-secondary); border-right: 1px solid var(--color-border); display: flex; flex-direction: column; }
.sidebar-header { padding: 1rem; border-bottom: 1px solid var(--color-border); }
.sidebar-nav { flex: 1; padding: 0.5rem; }
.nav-item { display: block; padding: 0.625rem 0.75rem; border-radius: 6px; color: var(--color-text); margin-bottom: 0.25rem; }
.nav-item:hover, .nav-item.active { background: var(--color-bg); text-decoration: none; }
.sidebar-footer { padding: 1rem; border-top: 1px solid var(--color-border); font-size: 0.875rem; }
.logout-btn { background: none; border: none; color: var(--color-text-secondary); font-size: 0.8rem; margin-left: 0.5rem; }
.main-content { flex: 1; overflow-y: auto; }
.header { padding: 1rem 1.5rem; border-bottom: 1px solid var(--color-border); display: flex; align-items: center; gap: 1rem; }
.header h3 { flex: 1; }
.header-actions { display: flex; gap: 0.5rem; }
.back-link { font-size: 0.875rem; color: var(--color-primary); text-decoration: none; white-space: nowrap; }
.content { padding: 1.5rem; }

.upload-area { padding: 1rem 1.5rem; border-bottom: 1px solid var(--color-border); background: var(--color-bg-secondary); display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
.file-input { max-width: 300px; }
.url-input { flex: 1; min-width: 200px; padding: 0.5rem 0.75rem; border: 1px solid var(--color-border); border-radius: 6px; font-size: 0.9rem; }

.table { width: 100%; border-collapse: collapse; }
.table th, .table td { text-align: left; padding: 0.625rem 0.75rem; border-bottom: 1px solid var(--color-border); font-size: 0.875rem; }
.table th { font-weight: 600; color: var(--color-text-secondary); font-size: 0.8rem; text-transform: uppercase; }
.doc-title { max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.type-badge { font-size: 0.75rem; padding: 0.125rem 0.5rem; background: var(--color-bg-secondary); border-radius: 4px; }
.status { font-size: 0.8rem; }
.status.processing { color: #f57c00; }
.status.completed { color: #2e7d32; }
.status.failed { color: #d32f2f; }
.date { white-space: nowrap; color: var(--color-text-secondary); font-size: 0.8rem; }

.loading { padding: 2rem; color: var(--color-text-secondary); }
.empty { text-align: center; padding: 4rem 2rem; color: var(--color-text-secondary); }

.btn-primary { padding: 0.5rem 1rem; background: var(--color-primary); color: white; border: none; border-radius: 6px; font-size: 0.9rem; cursor: pointer; }
.btn-primary:disabled { opacity: 0.5; }
.btn-secondary { padding: 0.5rem 1rem; background: var(--color-bg-secondary); border: 1px solid var(--color-border); border-radius: 6px; font-size: 0.9rem; cursor: pointer; }
.btn-danger-sm { padding: 0.25rem 0.5rem; background: none; border: 1px solid #f44336; color: #f44336; border-radius: 4px; font-size: 0.8rem; cursor: pointer; }
.error { color: #d32f2f; font-size: 0.875rem; }
</style>
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
}
.sidebar-header {
  padding: 1rem;
  border-bottom: 1px solid var(--color-border);
}
.sidebar-nav {
  flex: 1;
  padding: 0.5rem;
}
.nav-item {
  display: block;
  padding: 0.625rem 0.75rem;
  border-radius: 6px;
  color: var(--color-text);
  margin-bottom: 0.25rem;
}
.nav-item:hover,
.nav-item.active {
  background: var(--color-bg);
  text-decoration: none;
}
.sidebar-footer {
  padding: 1rem;
  border-top: 1px solid var(--color-border);
  font-size: 0.875rem;
}
.logout-btn {
  background: none;
  border: none;
  color: var(--color-text-secondary);
  font-size: 0.8rem;
  margin-left: 0.5rem;
}
.main-content {
  flex: 1;
}
.header {
  padding: 1rem 1.5rem;
  border-bottom: 1px solid var(--color-border);
}
.content {
  padding: 2rem 1.5rem;
}
</style>
