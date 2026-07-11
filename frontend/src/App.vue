<template>
  <div class="app-layout">
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
        <router-link to="/admin" class="nav-item">
          <i class="pi pi-cog"></i>
          <span>Admin</span>
        </router-link>
      </nav>
    </aside>

    <!-- Main Content -->
    <div class="app-main">
      <header class="app-header">
        <div class="header-left">
          <h1 class="app-title">Knora</h1>
        </div>
        <div class="header-right">
          <span class="user-badge">Admin</span>
        </div>
      </header>
      <main class="app-content">
        <router-view />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from "vue-router";

const router = useRouter();
</script>

<style>
@import "primeicons/primeicons.css";

:root {
  --sidebar-width: 260px;
  --header-height: 56px;
  --color-sidebar-bg: #1a1a2e;
  --color-sidebar-text: #e0e0e0;
  --color-sidebar-hover: #16213e;
  --color-sidebar-active: #0f3460;
  --color-header-bg: #ffffff;
  --color-content-bg: #f5f7fa;
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
  color: #1a1a1a;
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
  transition: background 0.15s, color 0.15s;
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

/* Main Area */
.app-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.app-header {
  height: var(--header-height);
  background: var(--color-header-bg);
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 1.5rem;
  flex-shrink: 0;
}

.app-title {
  font-size: 1.1rem;
  font-weight: 600;
  color: #374151;
}

.user-badge {
  font-size: 0.8rem;
  color: #6b7280;
  background: #f3f4f6;
  padding: 0.3rem 0.75rem;
  border-radius: 999px;
}

.app-content {
  flex: 1;
  padding: 1.5rem;
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
</style>
