<template>
  <main class="main-content">
    <!-- Tabs -->
    <div class="tabs">
      <button
        :class="['tab', { active: tab === 'users' }]"
        @click="tab = 'users'"
      >
        👥 Benutzer
      </button>
      <button
        :class="['tab', { active: tab === 'models' }]"
        @click="tab = 'models'"
      >
        🤖 Model-Provider
      </button>
    </div>

    <!-- User Management -->
    <div v-if="tab === 'users'" class="content">
      <div class="section-header">
        <h3>👥 Benutzer</h3>
      </div>
      <table class="table" v-if="users.length">
        <thead>
          <tr>
            <th>ID</th>
            <th>Name</th>
            <th>E-Mail</th>
            <th>Rolle</th>
            <th>Erstellt</th>
            <th>Aktion</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.id">
            <td>{{ u.id }}</td>
            <td>{{ u.name }}</td>
            <td>{{ u.email }}</td>
            <td>
              <select
                v-model="u.role"
                @change="updateRole(u)"
                :disabled="u.id === auth.user?.id"
              >
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
                <option value="admin">Admin</option>
              </select>
            </td>
            <td>{{ formatDate(u.created_at) }}</td>
            <td>
              <button
                class="btn-danger-sm"
                @click="deleteUser(u)"
                :disabled="u.id === auth.user?.id"
              >
                ✕
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty">Lade Benutzer...</p>
    </div>

    <!-- Model Provider Management -->
    <div v-if="tab === 'models'" class="content">
      <div class="section-header">
        <h3>🤖 Model-Provider</h3>
        <button class="btn-primary" @click="showCreate = true">+ Neu</button>
      </div>

      <div v-if="providers.length" class="provider-list">
        <div v-for="p in providers" :key="p.id" class="provider-card">
          <div class="provider-info">
            <strong>{{ p.name }}</strong>
            <span class="provider-type">{{ p.provider_type }}</span>
            <span class="provider-model">{{ p.default_model }}</span>
            <span class="provider-url">{{ p.api_base_url }}</span>
            <span class="provider-key">🔑 {{ p.api_key_preview }}</span>
          </div>
          <div class="provider-actions">
            <span
              :class="['status-dot', p.is_active ? 'active' : 'inactive']"
            ></span>
            <button class="btn-danger-sm" @click="deleteProvider(p.id)">
              ✕
            </button>
          </div>
        </div>
      </div>
      <p v-else class="empty">Noch keine Provider konfiguriert.</p>

      <!-- Create Provider Dialog -->
      <div
        v-if="showCreate"
        class="dialog-overlay"
        @click.self="showCreate = false"
      >
        <div class="dialog">
          <h3>Neuen Model-Provider erstellen</h3>
          <div class="field">
            <label>Name *</label>
            <input v-model="form.name" placeholder="z.B. OpenAI, DeepSeek" />
          </div>
          <div class="field">
            <label>Typ *</label>
            <select v-model="form.provider_type">
              <option value="chat">Chat</option>
              <option value="embedding">Embedding</option>
              <option value="both">Beides</option>
            </select>
          </div>
          <div class="field">
            <label>API Base URL *</label>
            <input
              v-model="form.api_base_url"
              placeholder="https://api.openai.com/v1"
            />
          </div>
          <div class="field">
            <label>API Key *</label>
            <input
              v-model="form.api_key"
              type="password"
              placeholder="sk-..."
            />
          </div>
          <div class="field">
            <label>Default Model *</label>
            <input
              v-model="form.default_model"
              placeholder="gpt-4o, deepseek-chat"
            />
          </div>
          <div class="dialog-actions">
            <button class="btn-secondary" @click="showCreate = false">
              Abbrechen
            </button>
            <button
              class="btn-primary"
              @click="createProvider"
              :disabled="!form.name || !form.api_key"
            >
              Erstellen
            </button>
          </div>
          <p v-if="createError" class="error">{{ createError }}</p>
        </div>
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
const tab = ref("users");
const users = ref<any[]>([]);
const providers = ref<any[]>([]);
const showCreate = ref(false);
const createError = ref("");
const form = ref({
  name: "",
  provider_type: "chat",
  api_base_url: "",
  api_key: "",
  default_model: "",
});

onMounted(async () => {
  if (!auth.isAuthenticated) {
    router.push("/login");
    return;
  }
  if (!auth.isAdmin) {
    router.push("/chat");
    return;
  }
  await loadUsers();
  await loadProviders();
});

async function loadUsers() {
  try {
    const res = await axios.get("/api/v1/admin/users");
    users.value = res.data.users || [];

    // .env-Admin (Elmo) zur Liste hinzufügen falls nicht in DB
    const envAdmin = auth.user;
    if (envAdmin && !users.value.find((u: any) => u.email === envAdmin.email)) {
      users.value.unshift({
        id: 0,
        name: envAdmin.name,
        email: envAdmin.email,
        role: "admin",
        created_at: new Date().toISOString(),
        _env: true, // Markierung für .env-User
      });
    }
  } catch (e: any) {
    console.error("Failed to load users", e);
  }
}

async function updateRole(u: any) {
  try {
    await axios.put(`/api/v1/admin/users/${u.id}/role`, { role: u.role });
  } catch {
    alert("Fehler beim Ändern der Rolle");
  }
}

async function deleteUser(u: any) {
  if (!confirm(`Benutzer "${u.name}" löschen?`)) return;
  try {
    await axios.delete(`/api/v1/admin/users/${u.id}`);
    users.value = users.value.filter((x: any) => x.id !== u.id);
  } catch {
    alert("Fehler beim Löschen");
  }
}

async function loadProviders() {
  try {
    const res = await axios.get("/api/v1/models");
    providers.value = res.data.providers || [];
  } catch (e: any) {
    console.error("Failed to load providers", e);
  }
}

async function createProvider() {
  createError.value = "";
  try {
    const res = await axios.post("/api/v1/models", { ...form.value });
    providers.value.push(res.data.provider);
    showCreate.value = false;
    form.value = {
      name: "",
      provider_type: "chat",
      api_base_url: "",
      api_key: "",
      default_model: "",
    };
  } catch (e: any) {
    createError.value = e.response?.data?.error || "Fehler beim Erstellen";
  }
}

async function deleteProvider(id: string) {
  if (!confirm("Provider löschen?")) return;
  try {
    await axios.delete(`/api/v1/models/${id}`);
    providers.value = providers.value.filter((p: any) => p.id !== id);
  } catch {
    alert("Fehler beim Löschen");
  }
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

.tabs {
  display: flex;
  border-bottom: 1px solid var(--color-border);
}
.tab {
  padding: 0.75rem 1.5rem;
  border: none;
  background: none;
  font-size: 0.9rem;
  cursor: pointer;
  color: var(--color-text);
  border-bottom: 2px solid transparent;
}
.tab.active {
  border-bottom-color: var(--color-primary);
  color: var(--color-primary);
  font-weight: 500;
}

.content {
  padding: 1.5rem;
}
.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
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
.table select {
  padding: 0.25rem 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  font-size: 0.875rem;
}

.provider-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.provider-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
}
.provider-info {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}
.provider-info strong {
  min-width: 100px;
}
.provider-type,
.provider-model,
.provider-url,
.provider-key {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}
.provider-type {
  background: var(--color-bg-secondary);
  padding: 0.125rem 0.5rem;
  border-radius: 4px;
}
.provider-url {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.provider-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}
.status-dot.active {
  background: #4caf50;
}
.status-dot.inactive {
  background: #f44336;
}

.empty {
  color: var(--color-text-secondary);
  padding: 2rem 0;
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

.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.dialog {
  background: white;
  padding: 2rem;
  border-radius: 12px;
  width: 100%;
  max-width: 500px;
}
.dialog h3 {
  margin-bottom: 1rem;
}
.field {
  margin-bottom: 1rem;
}
.field label {
  display: block;
  font-size: 0.875rem;
  font-weight: 500;
  margin-bottom: 0.25rem;
  color: var(--color-text-secondary);
}
.field input,
.field select {
  width: 100%;
  padding: 0.625rem 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 1rem;
  font-family: inherit;
}
.dialog-actions {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
  margin-top: 1.5rem;
}
.error {
  color: #d32f2f;
  font-size: 0.875rem;
  margin-top: 0.5rem;
}
</style>
