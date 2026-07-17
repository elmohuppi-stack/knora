import {
  pgTable,
  serial,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  password_hash: varchar("password_hash", { length: 255 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  role: varchar("role", { length: 20 }).notNull().default("viewer"),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

export const sessions = pgTable("sessions", {
  id: varchar("id", { length: 36 }).primaryKey(),
  user_id: integer("user_id")
    .notNull()
    .references(() => users.id),
  token: varchar("token", { length: 255 }).notNull().unique(),
  expires_at: timestamp("expires_at").notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const modelProviders = pgTable("model_providers", {
  id: varchar("id", { length: 36 }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  provider_type: varchar("provider_type", { length: 20 }).notNull(),
  api_base_url: varchar("api_base_url", { length: 512 }).notNull(),
  api_key_encrypted: text("api_key_encrypted").notNull(),
  default_model: varchar("default_model", { length: 255 }).notNull(),
  is_active: boolean("is_active").default(true).notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

export const workspaces = pgTable("workspaces", {
  id: varchar("id", { length: 36 }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  created_by: integer("created_by")
    .notNull()
    .references(() => users.id),
  chunk_size: integer("chunk_size").default(512).notNull(),
  chunk_overlap: integer("chunk_overlap").default(50).notNull(),
  embedding_model_id: varchar("embedding_model_id", { length: 36 }).references(
    () => modelProviders.id,
  ),
  chat_model_id: varchar("chat_model_id", { length: 36 }).references(
    () => modelProviders.id,
  ),
  indexing_strategy: jsonb("indexing_strategy").notNull().default({
    vector_enabled: true,
    keyword_enabled: true,
    wiki_enabled: false,
    graph_enabled: false,
  }),
  wiki_config: jsonb("wiki_config").default({
    auto_ingest: false,
    synthesis_model_id: null,
    wiki_language: "de",
    max_pages_per_ingest: 10,
    extraction_granularity: "standard",
  }),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    id: serial("id").primaryKey(),
    workspace_id: varchar("workspace_id", { length: 36 })
      .notNull()
      .references(() => workspaces.id),
    user_id: integer("user_id")
      .notNull()
      .references(() => users.id),
    role: varchar("role", { length: 20 }).notNull().default("viewer"),
    created_at: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    uniqueMember: uniqueIndex("unique_workspace_member").on(
      table.workspace_id,
      table.user_id,
    ),
  }),
);

export const documents = pgTable("documents", {
  id: varchar("id", { length: 36 }).primaryKey(),
  workspace_id: varchar("workspace_id", { length: 36 })
    .notNull()
    .references(() => workspaces.id),
  title: varchar("title", { length: 512 }).notNull(),
  type: varchar("type", { length: 50 }).notNull(),
  source: text("source").notNull(),
  source_url: text("source_url"),
  content: text("content"),
  file_path: text("file_path"),
  file_size: integer("file_size"),
  file_hash: varchar("file_hash", { length: 64 }),
  parse_status: varchar("parse_status", { length: 20 })
    .default("pending")
    .notNull(),
  parse_error: text("parse_error"),
  chunk_count: integer("chunk_count").default(0).notNull(),
  created_by: integer("created_by")
    .notNull()
    .references(() => users.id),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
  processed_at: timestamp("processed_at"),
});

export const chunks = pgTable("chunks", {
  id: varchar("id", { length: 36 }).primaryKey(),
  document_id: varchar("document_id", { length: 36 }),
  workspace_id: varchar("workspace_id", { length: 36 })
    .notNull()
    .references(() => workspaces.id),
  content: text("content").notNull(),
  chunk_index: integer("chunk_index").notNull(),
  token_count: integer("token_count").default(0).notNull(),
  embedding: vector("embedding", { dimensions: 1536 }),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const wikiPages = pgTable(
  "wiki_pages",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    workspace_id: varchar("workspace_id", { length: 36 })
      .notNull()
      .references(() => workspaces.id),
    slug: varchar("slug", { length: 255 }).notNull(),
    title: varchar("title", { length: 512 }).notNull(),
    summary: text("summary").notNull().default(""),
    content: text("content").notNull().default(""),
    page_type: varchar("page_type", { length: 20 })
      .default("article")
      .notNull(),
    status: varchar("status", { length: 20 }).default("published").notNull(),
    source_document_id: varchar("source_document_id", {
      length: 36,
    }).references(() => documents.id),
    out_links: jsonb("out_links").default([]).notNull(),
    in_links: jsonb("in_links").default([]).notNull(),
    aliases: jsonb("aliases").default([]).notNull(),
    source_refs: jsonb("source_refs").default([]).notNull(),
    chunk_refs: jsonb("chunk_refs").default([]).notNull(),
    page_metadata: jsonb("page_metadata").default({}).notNull(),
    version: integer("version").default(1).notNull(),
    created_by: integer("created_by").references(() => users.id),
    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    uniqueSlug: uniqueIndex("unique_workspace_slug").on(
      table.workspace_id,
      table.slug,
    ),
  }),
);

export const chatSessions = pgTable("chat_sessions", {
  id: varchar("id", { length: 36 }).primaryKey(),
  workspace_id: varchar("workspace_id", { length: 36 }).references(
    () => workspaces.id,
  ),
  user_id: integer("user_id")
    .notNull()
    .references(() => users.id),
  title: varchar("title", { length: 255 }),
  model_id: varchar("model_id", { length: 36 }).references(
    () => modelProviders.id,
  ),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

export const chatMessages = pgTable("chat_messages", {
  id: varchar("id", { length: 36 }).primaryKey(),
  session_id: varchar("session_id", { length: 36 })
    .notNull()
    .references(() => chatSessions.id),
  role: varchar("role", { length: 20 }).notNull(),
  content: text("content").notNull(),
  knowledge_refs: jsonb("knowledge_refs").default([]).notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const activityLogs = pgTable("activity_logs", {
  id: varchar("id", { length: 36 }).primaryKey(),
  action: varchar("action", { length: 100 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("started"),
  message: text("message").notNull().default(""),
  details: jsonb("details").default({}).notNull(),
  workspace_id: varchar("workspace_id", { length: 36 }).references(
    () => workspaces.id,
  ),
  document_id: varchar("document_id", { length: 36 }).references(
    () => documents.id,
  ),
  user_id: integer("user_id").references(() => users.id),
  duration_ms: integer("duration_ms"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});
