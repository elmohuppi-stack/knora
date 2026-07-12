import { createRouter, createWebHistory } from "vue-router";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      redirect: "/chat",
    },
    {
      path: "/login",
      name: "Login",
      component: () => import("../views/auth/Login.vue"),
    },
    {
      path: "/chat",
      name: "Chat",
      component: () => import("../views/chat/ChatView.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/wiki/:workspaceId?",
      name: "Wiki",
      component: () => import("../views/wiki/WikiBrowser.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/wiki/:workspaceId/:slug",
      name: "WikiPage",
      component: () => import("../views/wiki/WikiPage.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/workspaces",
      name: "Workspaces",
      component: () => import("../views/workspace/WorkspaceList.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/workspaces/:id",
      name: "WorkspaceDetail",
      component: () => import("../views/workspace/WorkspaceDetail.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/documents/:workspaceId",
      name: "Documents",
      component: () => import("../views/documents/DocumentList.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/documents/:workspaceId/:documentId",
      name: "DocumentDetail",
      component: () => import("../views/documents/DocumentDetail.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/admin",
      redirect: "/settings",
    },
    {
      path: "/settings",
      name: "Settings",
      component: () => import("../views/admin/AdminPanel.vue"),
      meta: { requiresAuth: true },
    },
  ],
});

// Navigation guard – umgeleitet zu /login wenn nicht authentifiziert
router.beforeEach((to, from, next) => {
  const token = localStorage.getItem("token");
  if (to.meta.requiresAuth && !token) {
    next({ name: "Login" });
  } else {
    next();
  }
});

export default router;
