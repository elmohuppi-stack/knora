<template>
  <div class="layout">
    <aside class="sidebar">
      <div class="sidebar-header"><h2>Wiki-Chat</h2></div>
      <nav class="sidebar-nav">
        <router-link to="/chat" class="nav-item">💬 Chat</router-link>
        <router-link to="/wiki" class="nav-item">📖 Wiki</router-link>
        <router-link to="/workspaces" class="nav-item active">📁 Workspaces</router-link>
        <router-link to="/admin" class="nav-item" v-if="auth.isAdmin">⚙️ Admin</router-link>
      </nav>
      <div class="sidebar-footer">
        <span>{{ auth.userName }}</span>
        <button @click="auth.logout(); $router.push('/login')" class="logout-btn">Abmelden</button>
      </div>
    </aside>

    <main class="main-content">
      <div class="header">
        <router-link to="/workspaces" class="back-link">← Übersicht</router-link>
        <h3>{{ ws?.name || 'Lädt...' }}</h3>
        <div class="header-actions">
          <button class="btn-secondary" @click="showEdit = true" v-if="ws">Bearbeiten</button>
          <button class="btn-danger" @click="deleteWs" v-if="ws">Löschen</button>
        </div>
      </div>

      <div class="content">
        <div v-if="!ws" class="loading">Lade Workspace...</div>

        <template v-else>
          <div class="detail-section">
            <h4>Beschreibung</h4>
            <p>{{ ws.description || 'Keine Beschreibung' }}</p>
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

          <div class="detail-section">
            <h4>Indexing Strategy</h4>
            <div class="indexing-grid">
              <label class="toggle-row">
                <input type="checkbox" v-model="ws.indexing_strategy.vector_enabled" disabled />
                <span>🔍 Vector Search</span>
              </label>
              <label class="toggle-row">
                <input type="checkbox" v-model="ws.indexing_strategy.keyword_enabled" disabled />
                <span>📄 Keyword Search</span>
              </label>
              <label class="toggle-row">
                <input type="checkbox" v-model="ws.indexing_strategy.wiki_enabled" disabled />
                <span>📖 Wiki Auto-Generierung</span>
              </label>
              <label class="toggle-row">
                <input type="checkbox" v-model="ws.indexing_strategy.graph_enabled" disabled />
                <span>🕸️ Knowledge Graph</span>
              </label>
            </div>
          </div>

          <div class="detail-section">
            <h4>Aktionen</h4>
            <div class="action-buttons">
              <button class="btn-primary" @click="$router.push('/documents/' + ws.id)">📄 Dokumente</button>
              <button class="btn-primary" @click="$router.push('/wiki/' + ws.id)">📖 Wiki</button>
              <button class="btn-primary" @click="$router.push('/chat')">💬 Chat</button>
            </div>
          </div>
        </template>
      </div>

      <!-- Edit Dialog -->
      <div v-if="showEdit && ws" class="dialog-overlay" @click.self="showEdit = false">
        <div class="dialog">
          <h3>Workspace bearbeiten</h3>
          <div class="field">
            <label>Name</label>
            <input v-model="editName" />
          </div>
          <div class="field">
            <label>Beschreibung</label>
            <textarea v-model="editDesc"></textarea>
          </div>
          <div class="dialog-actions">
            <button class="btn-secondary" @click="showEdit = false">Abbrechen</button>
            <button class="btn-primary" @click="updateWs">Speichern</button>
          </div>
        </div>
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
const ws = ref<any>(null);
const showEdit = ref(false);
const editName = ref("");
const editDesc = ref("");

const workspaceId = route.params.id as string;

onMounted(async () => {
  if (!auth.isAuthenticated) { router.push("/login"); return; }
  await loadWorkspace();
});

async function loadWorkspace() {
  try {
    const res = await axios.get(`/api/v1/workspaces/${workspaceId}`);
    ws.value = res.data.workspace;
    editName.value = ws.value.name;
    editDesc.value = ws.value.description || "";
  } catch (e: any) {
    console.error("Failed to load workspace", e);
  }
}

async function updateWs() {
  try {
    const res = await axios.put(`/api/v1/workspaces/${workspaceId}`, {
      name: editName.value,
      description: editDesc.value || undefined,
    });
    ws.value = res.data.workspace;
    showEdit.value = false;
  } catch (e: any) {
    alert("Fehler beim Speichern: " + (e.response?.data?.error || e.message));
  }
}

async function deleteWs() {
  if (!confirm(`Workspace "${ws.value?.name}" wirklich löschen?`)) return;
  try {
    await axios.delete(`/api/v1/workspaces/${workspaceId}`);
    router.push("/workspaces");
  } catch (e: any) {
    alert("Fehler beim Löschen: " + (e.response?.data?.error || e.message));
  }
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
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
.content { padding: 1.5rem; max-width: 800px; }

.detail-section { margin-bottom: 2rem; }
.detail-section h4 { margin-bottom: 0.5rem; font-size: 0.9rem; color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.05em; }

.detail-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin-bottom: 2rem; }
.detail-card { background: var(--color-bg-secondary); padding: 1rem; border-radius: 8px; }
.detail-card strong { display: block; font-size: 0.8rem; color: var(--color-text-secondary); margin-bottom: 0.25rem; }

.indexing-grid { display: flex; flex-direction: column; gap: 0.5rem; }
.toggle-row { display: flex; align-items: center; gap: 0.5rem; cursor: default; }
.toggle-row input { width: 18px; height: 18px; }

.action-buttons { display: flex; gap: 0.75rem; }
.btn-primary { padding: 0.5rem 1rem; background: var(--color-primary); color: white; border: none; border-radius: 6px; font-size: 0.9rem; cursor: pointer; }
.btn-secondary { padding: 0.5rem 1rem; background: var(--color-bg-secondary); border: 1px solid var(--color-border); border-radius: 6px; font-size: 0.9rem; cursor: pointer; }
.btn-danger { padding: 0.5rem 1rem; background: #d32f2f; color: white; border: none; border-radius: 6px; font-size: 0.9rem; cursor: pointer; }

.dialog-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; z-index: 100; }
.dialog { background: white; padding: 2rem; border-radius: 12px; width: 100%; max-width: 480px; }
.dialog h3 { margin-bottom: 1rem; }
.field { margin-bottom: 1rem; }
.field label { display: block; font-size: 0.875rem; font-weight: 500; margin-bottom: 0.25rem; color: var(--color-text-secondary); }
.field input, .field textarea { width: 100%; padding: 0.625rem 0.75rem; border: 1px solid var(--color-border); border-radius: 6px; font-size: 1rem; font-family: inherit; }
.field textarea { min-height: 80px; resize: vertical; }
.dialog-actions { display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1.5rem; }
.loading { padding: 2rem; color: var(--color-text-secondary); }
</style>
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
