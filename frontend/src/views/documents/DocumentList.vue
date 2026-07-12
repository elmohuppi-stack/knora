<template>
  <main class="main-content">
    <div class="header">
      <div class="header-left">
        <router-link to="/workspaces" class="back-link"
          >← Übersicht</router-link
        >
        <h3 v-if="ws">{{ ws.name }}</h3>
        <h3 v-else>📄 Dokumente</h3>
      </div>
      <div class="header-actions">
        <div class="tab-bar">
          <router-link
            :to="'/documents/' + (workspaceSlug || workspaceId)"
            class="tab active"
            >📄 Dokumente</router-link
          >
          <router-link
            :to="'/wiki/' + (workspaceSlug || workspaceId)"
            class="tab"
            >📖 Wiki</router-link
          >
        </div>
        <button
          class="btn-icon"
          @click="showSettings = true"
          title="Workspace-Einstellungen"
        >
          ⚙️
        </button>
        <button class="btn-primary" @click="showUpload = true">
          📤 Upload
        </button>
        <button class="btn-primary" @click="showUrl = true">🔗 URL</button>
        <button class="btn-primary" @click="showYoutube = true">
          ▶️ YouTube
        </button>
      </div>
    </div>
    <div class="header-sub">
      <router-link to="/settings" class="log-link"
        >📋 Aktivitätslog</router-link
      >
    </div>

    <!-- Upload Area -->
    <div v-if="showUpload" class="upload-area">
      <input
        type="file"
        ref="fileInput"
        @change="uploadFile"
        accept=".pdf,.docx,.md,.txt,.html,.csv"
        class="file-input"
      />
      <p v-if="uploading">📤 Lädt hoch...</p>
      <p v-if="uploadError" class="error">{{ uploadError }}</p>
      <button
        class="btn-secondary"
        @click="showUpload = false"
        v-if="!uploading"
      >
        Schließen
      </button>
    </div>

    <!-- URL Import -->
    <div v-if="showUrl" class="upload-area">
      <input v-model="urlInput" placeholder="https://..." class="url-input" />
      <button
        class="btn-primary"
        @click="importUrl"
        :disabled="!urlInput.trim() || importing"
      >
        {{ importing ? "⏳ Importiere..." : "Importieren" }}
      </button>
      <p v-if="urlError" class="error">{{ urlError }}</p>
      <button class="btn-secondary" @click="showUrl = false">Schließen</button>
    </div>

    <!-- YouTube Import -->
    <div v-if="showYoutube" class="upload-area">
      <input
        v-model="youtubeUrl"
        placeholder="https://youtube.com/watch?v=..."
        class="url-input"
      />
      <button
        class="btn-primary"
        @click="importYoutube"
        :disabled="!youtubeUrl.trim() || youtubing"
      >
        {{ youtubing ? "⏳ Importiere..." : "Importieren" }}
      </button>
      <p v-if="youtubeInfo" class="success">▶️ {{ youtubeInfo }}</p>
      <p v-if="youtubeError" class="error">{{ youtubeError }}</p>
      <button
        class="btn-secondary"
        @click="
          showYoutube = false;
          youtubeUrl = '';
          youtubeError = '';
          youtubeInfo = '';
        "
      >
        Schließen
      </button>
    </div>

    <!-- Document List -->
    <div class="content">
      <div v-if="loading" class="loading">Lade Dokumente...</div>

      <div v-else-if="docs.length === 0" class="empty">
        <p>
          Noch keine Dokumente. Lade eine Datei hoch oder importiere eine URL.
        </p>
      </div>

      <table v-else class="table">
        <thead>
          <tr>
            <th>Titel</th>
            <th>Typ</th>
            <th>Chunks</th>
            <th>Status</th>
            <th>Hochgeladen</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="doc in docs" :key="doc.id">
            <td
              class="doc-title"
              @click="showDocDetail(doc)"
              style="cursor: pointer"
            >
              {{ doc.title }}
            </td>
            <td>
              <span class="type-badge">{{ doc.type }}</span>
            </td>
            <td>{{ doc.chunk_count || "-" }}</td>
            <td>
              <span :class="['status', doc.parse_status]">
                {{ statusLabel(doc.parse_status) }}
              </span>
            </td>
            <td class="date">{{ formatDate(doc.created_at) }}</td>
            <td>
              <button class="btn-danger-sm" @click="deleteDoc(doc.id)">
                ✕
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Document Detail Dialog -->
    <div
      v-if="showDetail && selectedDoc"
      class="dialog-overlay"
      @click.self="showDetail = false"
    >
      <div class="dialog dialog-wide">
        <h3>{{ selectedDoc.title }}</h3>
        <div class="doc-meta-bar">
          <span class="type-badge">{{ selectedDoc.type }}</span>
          <span>Status: {{ statusLabel(selectedDoc.parse_status) }}</span>
          <span>Chunks: {{ selectedDoc.chunk_count || "-" }}</span>
          <span>Hochgeladen: {{ formatDate(selectedDoc.created_at) }}</span>
        </div>
        <div class="doc-content-box" v-if="selectedDoc.content">
          <pre>{{ selectedDoc.content }}</pre>
        </div>
        <p v-else class="empty">(Kein Inhalt)</p>
        <div class="dialog-actions">
          <button class="btn-secondary" @click="showDetail = false">
            Schließen
          </button>
        </div>
      </div>
    </div>

    <!-- Workspace Settings Dialog -->
    <div
      v-if="showSettings && ws"
      class="dialog-overlay"
      @click.self="showSettings = false"
    >
      <div class="dialog">
        <h3>⚙️ Workspace: {{ ws.name }}</h3>

        <div class="field">
          <label>Name</label>
          <input v-model="editName" />
        </div>
        <div class="field">
          <label>Beschreibung</label>
          <textarea v-model="editDesc"></textarea>
        </div>

        <div class="detail-grid">
          <div class="detail-card">
            <strong>Chunk Size</strong>
            <span>{{ ws.chunk_size }} Tokens</span>
          </div>
          <div class="detail-card">
            <strong>Chunk Overlap</strong>
            <span>{{ ws.chunk_overlap }} Tokens</span>
          </div>
          <div class="detail-card">
            <strong>Erstellt am</strong>
            <span>{{ formatDate(ws.created_at) }}</span>
          </div>
        </div>

        <div class="field">
          <label>Indexing Strategy</label>
          <div class="indexing-grid">
            <label class="toggle-row">
              <input
                type="checkbox"
                v-model="ws.indexing_strategy.vector_enabled"
                disabled
              />
              <span>🔍 Vector Search</span>
            </label>
            <label class="toggle-row">
              <input
                type="checkbox"
                v-model="ws.indexing_strategy.keyword_enabled"
                disabled
              />
              <span>📄 Keyword Search</span>
            </label>
            <label class="toggle-row">
              <input
                type="checkbox"
                v-model="ws.indexing_strategy.wiki_enabled"
                disabled
              />
              <span>📖 Wiki Auto-Generierung</span>
            </label>
            <label class="toggle-row">
              <input
                type="checkbox"
                v-model="ws.indexing_strategy.graph_enabled"
                disabled
              />
              <span>🕸️ Knowledge Graph</span>
            </label>
          </div>
        </div>

        <div class="dialog-actions">
          <button class="btn-secondary" @click="showSettings = false">
            Schließen
          </button>
          <button class="btn-primary" @click="updateWs">💾 Speichern</button>
          <button
            class="btn-danger"
            @click="deleteWs"
            style="margin-left: auto"
          >
            🗑️ Löschen
          </button>
        </div>
        <p v-if="settingsError" class="error">{{ settingsError }}</p>
      </div>
    </div>
    <ConfirmModal
      :show="confirm.show"
      :options="confirm.options"
      :on-confirm="confirm.onConfirm"
      :on-cancel="confirm.onCancel"
    />
  </main>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useAuthStore } from "../../stores/auth";
import { useWorkspace } from "../../composables/useWorkspace";
import { useConfirm } from "../../composables/useConfirm";
import ConfirmModal from "../../components/ConfirmModal.vue";
import axios from "axios";

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();
const { resolveWorkspace, isUUID, resolving } = useWorkspace();
const confirm = useConfirm();

const rawWorkspaceId = route.params.workspaceId as string;
const workspaceId = ref(rawWorkspaceId);
const workspaceSlug = ref("");

const docs = ref<any[]>([]);
const ws = ref<any>(null);
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

// Workspace settings
const showSettings = ref(false);
const editName = ref("");
const editDesc = ref("");
const settingsError = ref("");

// Document detail
const showDetail = ref(false);
const selectedDoc = ref<any>(null);

function showDocDetail(doc: any) {
  selectedDoc.value = doc;
  showDetail.value = true;
}

onMounted(async () => {
  if (!auth.isAuthenticated) {
    router.push("/login");
    return;
  }
  if (!rawWorkspaceId) {
    router.push("/workspaces");
    return;
  }

  // Slug auflösen falls nötig
  if (!isUUID(rawWorkspaceId)) {
    const resolved = await resolveWorkspace(rawWorkspaceId);
    if (!resolved) {
      router.push("/workspaces");
      return;
    }
    workspaceId.value = resolved.id;
    workspaceSlug.value = resolved.slug;
  }

  await Promise.all([loadDocs(), loadWorkspace()]);
});

async function loadWorkspace() {
  try {
    const res = await axios.get(`/api/v1/workspaces/${workspaceId.value}`);
    ws.value = res.data.workspace;
    editName.value = ws.value.name;
    editDesc.value = ws.value.description || "";
    workspaceSlug.value = ws.value.slug;
  } catch (e: any) {
    console.error("Failed to load workspace", e);
  }
}

async function updateWs() {
  settingsError.value = "";
  try {
    const res = await axios.put(`/api/v1/workspaces/${workspaceId.value}`, {
      name: editName.value,
      description: editDesc.value || undefined,
    });
    ws.value = res.data.workspace;
    showSettings.value = false;
  } catch (e: any) {
    settingsError.value = e.response?.data?.error || "Fehler beim Speichern";
  }
}

async function deleteWs() {
  const ok = await confirm.confirm({
    title: "Workspace löschen",
    message: `Soll der Workspace „${ws.value?.name}” wirklich gelöscht werden? Alle Dokumente und Wiki-Seiten werden entfernt.`,
    confirmText: "Endgültig löschen",
  });
  if (!ok) return;
  try {
    await axios.delete(`/api/v1/workspaces/${workspaceId.value}`);
    router.push("/workspaces");
  } catch (e: any) {
    settingsError.value =
      "Fehler beim Löschen: " + (e.response?.data?.error || e.message);
  }
}

async function loadDocs() {
  try {
    const res = await axios.get(`/api/v1/documents/${workspaceId.value}`);
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
    await axios.post(`/api/v1/documents/upload/${workspaceId.value}`, form, {
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
      workspace_id: workspaceId.value,
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
      workspace_id: workspaceId.value,
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
  const ok = await confirm.confirm({
    title: "Dokument löschen",
    message: "Soll dieses Dokument wirklich gelöscht werden?",
    confirmText: "Löschen",
  });
  if (!ok) return;
  try {
    await axios.delete(`/api/v1/documents/${id}`);
    docs.value = docs.value.filter((d: any) => d.id !== id);
  } catch {
    alert("Fehler beim Löschen");
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
.header-sub {
  padding: 0.25rem 1.5rem;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg-secondary);
  display: flex;
  align-items: center;
  gap: 1rem;
}
.log-link {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  text-decoration: none;
}
.log-link:hover {
  color: var(--color-primary);
}
.back-link {
  font-size: 0.875rem;
  color: var(--color-primary);
  text-decoration: none;
  white-space: nowrap;
}
.btn-icon {
  background: none;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 0.4rem 0.6rem;
  cursor: pointer;
  font-size: 1.1rem;
  line-height: 1;
}
.btn-icon:hover {
  background: var(--color-bg-secondary);
}
.tab-bar {
  display: flex;
  gap: 0.25rem;
  background: var(--color-bg-secondary);
  border-radius: 8px;
  padding: 0.2rem;
}
.tab {
  padding: 0.4rem 1rem;
  border-radius: 6px;
  text-decoration: none;
  font-size: 0.875rem;
  color: var(--color-text-secondary);
  white-space: nowrap;
}
.tab.active {
  background: white;
  color: var(--color-text);
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}
.tab:hover:not(.active) {
  color: var(--color-text);
}

/* Settings Dialog */
.detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 0.75rem;
  margin-bottom: 1rem;
}
.detail-card {
  background: var(--color-bg-secondary);
  border-radius: 6px;
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.detail-card strong {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}
.detail-card span {
  font-size: 0.9rem;
  font-weight: 600;
}
.indexing-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 0.5rem;
}
.toggle-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  padding: 0.4rem 0;
}

/* Document Detail Dialog */
.doc-meta-bar {
  display: flex;
  gap: 1rem;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  margin-bottom: 1rem;
  flex-wrap: wrap;
  align-items: center;
}
.doc-content-box {
  max-height: 60vh;
  overflow-y: auto;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 1rem;
}
.doc-content-box pre {
  white-space: pre-wrap;
  word-wrap: break-word;
  font-size: 0.85rem;
  line-height: 1.6;
  font-family: inherit;
  margin: 0;
}

.content {
  padding: 1.5rem;
}

.upload-area {
  padding: 1rem 1.5rem;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg-secondary);
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}
.file-input {
  max-width: 300px;
}
.url-input {
  flex: 1;
  min-width: 200px;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 0.9rem;
}

.table {
  width: 100%;
  border-collapse: collapse;
}
.table th,
.table td {
  text-align: left;
  padding: 0.625rem 0.75rem;
  border-bottom: 1px solid var(--color-border);
  font-size: 0.875rem;
}
.table th {
  font-weight: 600;
  color: var(--color-text-secondary);
  font-size: 0.8rem;
  text-transform: uppercase;
}
.doc-title {
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.type-badge {
  font-size: 0.75rem;
  padding: 0.125rem 0.5rem;
  background: var(--color-bg-secondary);
  border-radius: 4px;
}
.status {
  font-size: 0.8rem;
}
.status.processing {
  color: #f57c00;
}
.status.completed {
  color: #2e7d32;
}
.status.failed {
  color: #d32f2f;
}
.date {
  white-space: nowrap;
  color: var(--color-text-secondary);
  font-size: 0.8rem;
}

.loading {
  padding: 2rem;
  color: var(--color-text-secondary);
}
.empty {
  text-align: center;
  padding: 4rem 2rem;
  color: var(--color-text-secondary);
}

.btn-primary {
  padding: 0.5rem 1rem;
  background: var(--color-primary);
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 0.9rem;
  cursor: pointer;
}
.btn-primary:disabled {
  opacity: 0.5;
}
.btn-secondary {
  padding: 0.5rem 1rem;
  background: var(--color-bg-secondary);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 0.9rem;
  cursor: pointer;
}
.btn-danger-sm {
  padding: 0.25rem 0.5rem;
  background: none;
  border: 1px solid #f44336;
  color: #f44336;
  border-radius: 4px;
  font-size: 0.8rem;
  cursor: pointer;
}
.btn-danger {
  padding: 0.4rem 0.85rem;
  border-radius: 6px;
  font-size: 0.85rem;
  font-weight: 500;
  border: none;
  cursor: pointer;
  transition: opacity 0.15s;
  white-space: nowrap;
  background: #f44336;
  color: #fff;
}
.btn-danger:hover {
  opacity: 0.9;
}
.error {
  color: #d32f2f;
  font-size: 0.875rem;
}
</style>
