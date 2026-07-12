<template>
  <!-- Nur Layout anzeigen wenn eingeloggt -->
  <div class="app-layout" v-if="auth.isAuthenticated">
    <!-- Sidebar -->
    <aside class="app-sidebar">
      <div class="sidebar-header">
        <router-link to="/" class="sidebar-logo">🧠 Knora</router-link>
      </div>
      <nav class="sidebar-nav">
        <router-link to="/chat" class="nav-item">
          <i class="pi pi-comments"></i>
          <span>Chat</span>
        </router-link>
        <router-link to="/workspaces" class="nav-item">
          <i class="pi pi-folder"></i>
          <span>Workspaces</span>
        </router-link>
        <router-link to="/wiki" class="nav-item">
          <i class="pi pi-book"></i>
          <span>Wiki</span>
        </router-link>
        <router-link to="/settings" class="nav-item">
          <i class="pi pi-cog"></i>
          <span>Einstellungen</span>
        </router-link>
      </nav>
      <div class="sidebar-footer">
        <button
          class="theme-toggle"
          @click="toggleTheme"
          :title="isDark ? 'Helles Design' : 'Dunkles Design'"
        >
          <i :class="isDark ? 'pi pi-sun' : 'pi pi-moon'"></i>
        </button>
        <span class="sidebar-user">{{ auth.userName }}</span>
        <button class="sidebar-logout" @click="logout">Abmelden</button>
      </div>
    </aside>

    <!-- Main Content -->
    <div class="app-main">
      <main class="app-content">
        <router-view />
      </main>
    </div>
  </div>

  <!-- Login-Seite ohne Layout -->
  <router-view v-else />
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import { useAuthStore } from "./stores/auth";
import { useRouter } from "vue-router";

const auth = useAuthStore();
const router = useRouter();

const isDark = ref(localStorage.getItem("knora-theme") === "dark");

onMounted(() => {
  applyTheme();
});

watch(isDark, () => {
  applyTheme();
  localStorage.setItem("knora-theme", isDark.value ? "dark" : "light");
});

function applyTheme() {
  document.documentElement.setAttribute(
    "data-theme",
    isDark.value ? "dark" : "light",
  );
}

function toggleTheme() {
  isDark.value = !isDark.value;
}

function logout() {
  auth.logout();
  router.push("/login");
}
</script>

<style>
@import "primeicons/primeicons.css";

:root {
  --sidebar-width: 260px;
  --header-height: 56px;
}

/* Light Theme (default) */
:root,
[data-theme="light"] {
  --color-sidebar-bg: #1a1a2e;
  --color-sidebar-text: #e0e0e0;
  --color-sidebar-hover: #16213e;
  --color-sidebar-active: #0f3460;
  --color-header-bg: #ffffff;
  --color-content-bg: #f5f7fa;
  --color-text: #1a1a1a;
  --color-text-secondary: #6b7280;
  --color-border: #e5e7eb;
  --color-bg: #ffffff;
  --color-bg-secondary: #f3f4f6;
  --color-primary: #1a1a2e;
}

/* Dark Theme */
[data-theme="dark"] {
  --color-sidebar-bg: #0d0d1a;
  --color-sidebar-text: #c0c0c0;
  --color-sidebar-hover: #1a1a2e;
  --color-sidebar-active: #0f3460;
  --color-header-bg: #1a1a2e;
  --color-content-bg: #111118;
  --color-text: #e0e0e0;
  --color-text-secondary: #9ca3af;
  --color-border: #2d2d3a;
  --color-bg: #1a1a2e;
  --color-bg-secondary: #16162a;
  --color-primary: #4f8cff;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html,
body {
  height: 100%;
  font-family:
    -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: var(--color-text);
  background: var(--color-content-bg);
  line-height: 1.6;
}

#app {
  height: 100%;
}

.app-layout {
  display: flex;
  height: 100vh;
}

/* Sidebar */
.app-sidebar {
  width: var(--sidebar-width);
  background: var(--color-sidebar-bg);
  color: var(--color-sidebar-text);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.sidebar-header {
  padding: 1.25rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.sidebar-logo {
  font-size: 1.35rem;
  font-weight: 700;
  color: #fff;
  text-decoration: none;
  letter-spacing: -0.5px;
}

.sidebar-nav {
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.7rem 0.85rem;
  border-radius: 8px;
  color: var(--color-sidebar-text);
  text-decoration: none;
  font-size: 0.925rem;
  transition:
    background 0.15s,
    color 0.15s;
}

.nav-item:hover {
  background: var(--color-sidebar-hover);
  color: #fff;
}

.nav-item.router-link-active,
.nav-item.router-link-exact-active {
  background: var(--color-sidebar-active);
  color: #fff;
}

.nav-item i {
  font-size: 1.1rem;
  width: 1.25rem;
  text-align: center;
}

/* Sidebar Footer */
.sidebar-footer {
  padding: 0.75rem;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.sidebar-footer .sidebar-user {
  flex: 1;
}

.sidebar-user {
  font-size: 0.8rem;
  color: var(--color-sidebar-text);
  opacity: 0.8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.theme-toggle {
  background: none;
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: var(--color-sidebar-text);
  font-size: 0.85rem;
  padding: 0.3rem 0.5rem;
  border-radius: 6px;
  cursor: pointer;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    background 0.15s,
    border-color 0.15s;
}

.theme-toggle:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.3);
}

.sidebar-logout {
  background: none;
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: var(--color-sidebar-text);
  font-size: 0.75rem;
  padding: 0.3rem 0.6rem;
  border-radius: 6px;
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background 0.15s,
    border-color 0.15s;
}

.sidebar-logout:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.3);
}

/* Main Area */
.app-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.app-content {
  flex: 1;
  overflow-y: auto;
}

a {
  color: var(--color-sidebar-active);
  text-decoration: none;
}

button {
  cursor: pointer;
  font-family: inherit;
}
</style>
