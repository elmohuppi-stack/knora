<template>
  <main class="chat-layout">
    <!-- Historie-Sidebar -->
    <aside class="chat-sidebar">
      <button class="new-chat-btn" @click="newChat">
        <span>＋</span> Neuer Chat
      </button>

      <div class="session-list">
        <div v-if="sessions.length === 0" class="session-empty">
          Noch keine Unterhaltungen.
        </div>
        <template v-for="group in groupedSessions" :key="group.label">
          <div v-if="group.sessions.length" class="session-group-label">
            {{ group.label }}
          </div>
          <button
            v-for="s in group.sessions"
            :key="s.id"
            :class="['session-item', { active: s.id === sessionId }]"
            @click="openSession(s)"
            :title="s.title || 'Unterhaltung'"
          >
            {{ s.title || "Unterhaltung" }}
          </button>
        </template>
      </div>
    </aside>

    <!-- Chat-Bereich -->
    <section class="chat-main">
      <div class="chat-header">
        <h3>Chat</h3>
      </div>

      <div class="messages" ref="messagesRef">
        <div v-if="messages.length === 0" class="empty-state">
          <p>Starte eine Unterhaltung mit deinem Wiki-Wissen.</p>
        </div>
        <div
          v-for="msg in messages"
          :key="msg.id"
          :class="['message', msg.role]"
        >
          <div class="avatar">{{ msg.role === "user" ? "👤" : "🤖" }}</div>
          <div class="bubble">
            <div v-html="renderMarkdown(msg.content)"></div>
            <div v-if="msg.knowledge_refs?.length" class="refs">
              <small>Quellen: {{ msg.knowledge_refs.length }} Chunks</small>
            </div>
          </div>
        </div>
        <div v-if="isStreaming" class="message assistant">
          <div class="avatar">🤖</div>
          <div class="bubble streaming">
            <span class="cursor-blink">▊</span>
          </div>
        </div>
      </div>

      <div class="input-bar">
        <select v-model="workspaceId" class="ws-select">
          <option value="">— Alle Workspaces —</option>
          <option v-for="ws in workspaces" :key="ws.id" :value="ws.id">
            {{ ws.name }}
          </option>
        </select>
        <input
          v-model="input"
          @keydown.enter="sendMessage"
          placeholder="Nachricht eingeben..."
          class="msg-input"
          :disabled="isStreaming"
        />
        <button
          @click="sendMessage"
          :disabled="!input.trim() || isStreaming"
          class="send-btn"
        >
          Senden
        </button>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../../stores/auth";
import { marked } from "marked";
import DOMPurify from "dompurify";
import axios from "axios";

const auth = useAuthStore();
const router = useRouter();
const messages = ref<any[]>([]);
const input = ref("");
const workspaceId = ref("");
const workspaces = ref<any[]>([]);
const isStreaming = ref(false);
const messagesRef = ref<HTMLDivElement>();
const sessions = ref<any[]>([]);
const sessionId = ref<string | null>(null);

onMounted(() => {
  if (!auth.isAuthenticated) {
    router.push("/login");
    return;
  }
  loadWorkspaces();
  loadSessions();
});

async function loadWorkspaces() {
  try {
    const res = await axios.get("/api/v1/workspaces");
    workspaces.value = res.data.workspaces;
    // Zuletzt verwendeten Workspace vorauswählen (analog zum Workspace-Tab)
    const last = localStorage.getItem("lastWorkspaceId");
    if (last && workspaces.value.some((w: any) => w.id === last)) {
      workspaceId.value = last;
    }
  } catch {}
}

// Auswahl im Chat ebenfalls als "zuletzt verwendet" merken
watch(workspaceId, (v) => {
  if (v) localStorage.setItem("lastWorkspaceId", v);
});

async function loadSessions() {
  try {
    const res = await axios.get("/api/v1/chat/sessions");
    sessions.value = res.data.sessions || [];
  } catch {}
}

// Sessions nach Aktualität gruppieren (Heute / Letzte 30 Tage / Älter)
const groupedSessions = computed(() => {
  const now = Date.now();
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const groups: Record<string, any[]> = { today: [], month: [], older: [] };
  for (const s of sessions.value) {
    const t = new Date(s.updated_at || s.created_at).getTime();
    if (t >= startOfToday) groups.today.push(s);
    else if (now - t < 30 * 24 * 3600 * 1000) groups.month.push(s);
    else groups.older.push(s);
  }
  return [
    { label: "Heute", sessions: groups.today },
    { label: "Letzte 30 Tage", sessions: groups.month },
    { label: "Älter", sessions: groups.older },
  ];
});

function newChat() {
  sessionId.value = null;
  messages.value = [];
  input.value = "";
}

async function openSession(s: any) {
  if (isStreaming.value) return;
  sessionId.value = s.id;
  if (s.workspace_id) workspaceId.value = s.workspace_id;
  try {
    const res = await axios.get(`/api/v1/chat/sessions/${s.id}/messages`);
    messages.value = (res.data.messages || []).map((m: any) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      knowledge_refs: m.knowledge_refs || [],
    }));
    scrollToBottom();
  } catch {}
}

function renderMarkdown(text: string) {
  const html = marked.parse(text, { async: false }) as string;
  return DOMPurify.sanitize(html);
}

function scrollToBottom() {
  setTimeout(() => {
    messagesRef.value?.scrollTo({
      top: messagesRef.value.scrollHeight,
      behavior: "smooth",
    });
  }, 50);
}

async function sendMessage() {
  if (!input.value.trim() || isStreaming.value) return;

  const userMsg = {
    id: crypto.randomUUID(),
    role: "user",
    content: input.value,
    knowledge_refs: [],
  };
  messages.value.push(userMsg);
  const query = input.value;
  input.value = "";
  isStreaming.value = true;

  // Streaming-Assistant-Nachricht vorbereiten
  const assistantMsg = {
    id: crypto.randomUUID(),
    role: "assistant",
    content: "",
    knowledge_refs: [],
  };
  messages.value.push(assistantMsg);

  try {
    const res = await fetch("/api/v1/chat/stream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(auth.token ? { Authorization: `Bearer ${auth.token}` } : {}),
      },
      body: JSON.stringify({
        workspace_id: workspaceId.value || undefined,
        message: query,
        session_id: sessionId.value || undefined,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(err);
    }

    // Session-ID aus Header lesen (bei neuer Session gesetzt)
    const returnedSession = res.headers.get("X-Session-Id");
    if (returnedSession) sessionId.value = returnedSession;

    // SSE-Stream lesen
    const reader = res.body?.getReader();
    const decoder = new TextDecoder();

    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        assistantMsg.content += text;
        // Scrollen bei jedem Chunk
        messagesRef.value?.scrollTo({
          top: messagesRef.value.scrollHeight,
          behavior: "smooth",
        });
      }
    }
  } catch (e: any) {
    assistantMsg.content = "❌ Fehler bei der Anfrage: " + e.message;
  } finally {
    isStreaming.value = false;
    scrollToBottom();
    // Sidebar aktualisieren: neue Session einfügen bzw. Reihenfolge auffrischen
    loadSessions();
  }
}
</script>

<style scoped>
.chat-layout {
  flex: 1;
  display: flex;
  min-height: 0;
}

/* Historie-Sidebar */
.chat-sidebar {
  width: 240px;
  flex-shrink: 0;
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  background: var(--color-bg-secondary);
}

.new-chat-btn {
  margin: 0.75rem;
  padding: 0.6rem 0.75rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: var(--color-primary);
  color: #fff;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 600;
}
.new-chat-btn span {
  font-size: 1.1rem;
  line-height: 1;
}

.session-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 0.5rem 0.75rem;
}

.session-empty {
  padding: 1rem 0.75rem;
  color: var(--color-text-secondary);
  font-size: 0.85rem;
}

.session-group-label {
  padding: 0.75rem 0.5rem 0.25rem;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--color-text-secondary);
}

.session-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 0.5rem;
  margin-bottom: 0.1rem;
  background: none;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.85rem;
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.session-item:hover {
  background: var(--color-border);
}
.session-item.active {
  background: var(--color-primary);
  color: #fff;
}

.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.chat-header {
  padding: 1rem 1.5rem;
  border-bottom: 1px solid var(--color-border);
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 1rem 1.5rem;
}

.empty-state {
  text-align: center;
  padding: 4rem 2rem;
  color: var(--color-text-secondary);
}

.message {
  display: flex;
  gap: 0.75rem;
  margin-bottom: 1.25rem;
}

.avatar {
  font-size: 1.5rem;
  line-height: 1;
}

.bubble {
  max-width: 70%;
  padding: 0.75rem 1rem;
  border-radius: 12px;
  background: var(--color-bg-secondary);
  line-height: 1.5;
}

.message.user {
  flex-direction: row-reverse;
}

.message.user .bubble {
  background: var(--color-primary);
  color: white;
}

.refs {
  margin-top: 0.5rem;
  opacity: 0.6;
}

.streaming .cursor-blink {
  animation: blink 1s steps(1) infinite;
}

@keyframes blink {
  50% {
    opacity: 0;
  }
}

.input-bar {
  display: flex;
  gap: 0.5rem;
  padding: 1rem 1.5rem;
  border-top: 1px solid var(--color-border);
  align-items: center;
}

.ws-select {
  padding: 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 0.875rem;
}

.msg-input {
  flex: 1;
  padding: 0.625rem 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 1rem;
}

.msg-input:focus {
  outline: none;
  border-color: var(--color-primary);
}

.send-btn {
  padding: 0.625rem 1.25rem;
  background: var(--color-primary);
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 0.9rem;
}

.send-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
