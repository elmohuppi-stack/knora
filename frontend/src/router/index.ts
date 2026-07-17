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
    // --- Workspace Hub (Tabs: Documents, Wiki, Graph) ---
    {
      path: "/workspaces",
      name: "Workspaces",
      component: () => import("../views/workspace/WorkspaceList.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/workspaces/:id",
      component: () => import("../views/workspace/WorkspaceHub.vue"),
      meta: { requiresAuth: true },
      redirect: (to) => ({ path: `/workspaces/${to.params.id}/documents` }),
      children: [
        {
          path: "documents",
          name: "WorkspaceDocuments",
          component: () => import("../views/documents/DocumentList.vue"),
        },
        {
          path: "documents/:documentId",
          name: "WorkspaceDocumentDetail",
          component: () => import("../views/documents/DocumentDetail.vue"),
        },
        {
          path: "wiki",
          name: "WorkspaceWiki",
          component: () => import("../views/wiki/WikiBrowser.vue"),
        },
        {
          path: "wiki/:slug(.*)",
          name: "WorkspaceWikiPage",
          component: () => import("../views/wiki/WikiBrowser.vue"),
        },
        {
          path: "graph",
          name: "WorkspaceGraph",
          component: () => import("../views/wiki/WikiBrowser.vue"),
        },
        {
          path: "settings",
          name: "WorkspaceSettings",
          component: () => import("../views/workspace/WorkspaceDetail.vue"),
        },
      ],
    },
    // --- Alte Pfade (Redirects) ---
    {
      path: "/wiki/:workspaceId?",
      redirect: (to) => {
        if (to.params.workspaceId) {
          return `/workspaces/${to.params.workspaceId}/wiki`;
        }
        return "/workspaces";
      },
    },
    {
      path: "/wiki/:workspaceId/:slug",
      redirect: (to) =>
        `/workspaces/${to.params.workspaceId}/wiki/${to.params.slug}`,
    },
    {
      path: "/documents/:workspaceId",
      redirect: (to) => `/workspaces/${to.params.workspaceId}/documents`,
    },
    {
      path: "/documents/:workspaceId/:documentId",
      redirect: (to) =>
        `/workspaces/${to.params.workspaceId}/documents/${to.params.documentId}`,
    },
    // --- Einstellungen ---
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

// Navigation guard
router.beforeEach((to, from, next) => {
  const token = localStorage.getItem("token");
  if (to.meta.requiresAuth && !token) {
    next({ name: "Login" });
  } else {
    next();
  }
});

export default router;
