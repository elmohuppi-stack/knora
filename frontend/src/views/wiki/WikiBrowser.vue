<template>
  <main class="wiki-main">
    <div class="wiki-header">
      <h3>📖 Wiki</h3>
      <select v-model="workspaceId" @change="loadPages" class="ws-select">
        <option value="">— Workspace wählen —</option>
        <option v-for="ws in workspaces" :key="ws.id" :value="ws.id">
          {{ ws.name }}
        </option>
      </select>
      <div class="header-actions" v-if="workspaceId">
        <button class="btn-primary" @click="showCreate = true">
          + Neue Seite
        </button>
      </div>
    </div>

    <template v-if="workspaceId">
      <div class="wiki-toolbar">
        <input
          v-model="searchQuery"
          @input="loadPages"
          placeholder="Wiki durchsuchen..."
          class="search-input"
        />
        <span class="page-count">{{ totalPages }} Seiten</span>
      </div>
      <div class="wiki-content">
        <div v-if="loading" class="status-text">Lade...</div>
        <div v-else-if="pages.length === 0" class="status-text">
          <p>
            Noch keine Wiki-Seiten. Generiere Seiten aus Dokumenten oder
            erstelle sie manuell.
          </p>
        </div>
        <div v-else class="page-list">
          <div
            v-for="p in pages"
            :key="p.id"
            class="page-card"
            @click="
              $router.push(`/wiki/${workspaceId}/${encodeURIComponent(p.slug)}`)
            "
          >
            <div class="page-type-badge">{{ typeIcon(p.page_type) }}</div>
            <div class="page-info">
              <h4>{{ p.title }}</h4>
              <p class="page-summary">
                {{ p.summary || "Keine Zusammenfassung" }}
              </p>
              <div class="page-meta">
                <span>{{ p.page_type }}</span>
                <span>{{ formatDate(p.updated_at) }}</span>
                <span v-if="p.out_links?.length"
                  >{{ p.out_links.length }} →</span
                >
                <span v-if="p.in_links?.length">{{ p.in_links.length }} ←</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
    <div v-else class="wiki-empty">
      <p>Wähle einen Workspace aus, um dessen Wiki zu durchsuchen.</p>
    </div>

    <div
      v-if="showCreate"
      class="dialog-overlay"
      @click.self="showCreate = false"
    >
      <div class="dialog">
        <h3>Neue Wiki-Seite</h3>
        <div class="field">
          <label>Titel *</label
          ><input
            v-model="form.title"
            placeholder="Titel"
            @input="generateSlug"
          />
        </div>
        <div class="field">
          <label>Slug *</label
          ><input v-model="form.slug" placeholder="wiki/mein-artikel" />
        </div>
        <div class="field">
          <label>Typ</label>
          <select v-model="form.page_type">
            <option value="article">Artikel</option>
            <option value="entity">Entität</option>
            <option value="concept">Konzept</option>
          </select>
        </div>
        <div class="dialog-actions">
          <button class="btn-secondary" @click="showCreate = false">
            Abbrechen
          </button>
          <button
            class="btn-primary"
            @click="createPage"
            :disabled="!form.title || !form.slug"
          >
            Erstellen
          </button>
        </div>
        <p v-if="createError" class="error">{{ createError }}</p>
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
const workspaces = ref<any[]>([]);
const workspaceId = ref("");
const pages = ref<any[]>([]);
const totalPages = ref(0);
const loading = ref(false);
const searchQuery = ref("");
const showCreate = ref(false);
const createError = ref("");
const form = ref({ title: "", slug: "", page_type: "article" });

onMounted(async () => {
  if (!auth.isAuthenticated) {
    router.push("/login");
    return;
  }
  await loadWorkspaces();
});

async function loadWorkspaces() {
  try {
    const res = await axios.get("/api/v1/workspaces");
    workspaces.value = res.data.workspaces || [];
  } catch {}
}

async function loadPages() {
  if (!workspaceId.value) return;
  loading.value = true;
  try {
    const params: any = {};
    if (searchQuery.value) params.query = searchQuery.value;
    const res = await axios.get(`/api/v1/wiki/${workspaceId.value}/pages`, {
      params,
    });
    pages.value = res.data.pages || [];
    totalPages.value = res.data.total || 0;
  } catch (e: any) {
    console.error("Failed to load pages", e);
  } finally {
    loading.value = false;
  }
}

function generateSlug() {
  if (form.value.title && !form.value.slug.startsWith("wiki/")) {
    form.value.slug =
      "wiki/" +
      form.value.title
        .toLowerCase()
        .replace(/[^a-z0-9äöüß\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .slice(0, 80);
  }
}

async function createPage() {
  createError.value = "";
  try {
    await axios.post(`/api/v1/wiki/${workspaceId.value}/pages`, form.value);
    showCreate.value = false;
    form.value = { title: "", slug: "", page_type: "article" };
    await loadPages();
  } catch (e: any) {
    createError.value = e.response?.data?.error || "Fehler";
  }
}

function typeIcon(t: string) {
  return t === "entity" ? "👤" : t === "concept" ? "💡" : "📄";
}
function formatDate(d: string) {
  return new Date(d).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
</script>

<style scoped>
.wiki-main {
  flex: 1;
}
.wiki-header {
  padding: 1rem 1.5rem;
  border-bottom: 1px solid var(--color-border);
}
.wiki-subtitle {
  color: var(--color-text-secondary);
  font-size: 0.875rem;
}
.wiki-empty {
  padding: 4rem 1.5rem;
  text-align: center;
  color: var(--color-text-secondary);
}
</style>
