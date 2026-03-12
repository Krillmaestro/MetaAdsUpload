import { pgTable, text, integer, real, boolean, timestamp, jsonb, serial, varchar, date } from "drizzle-orm/pg-core";

export const templates = pgTable("templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  objective: text("objective").default("OUTCOME_SALES"),
  budgetType: text("budget_type").default("ABO"),
  dailyBudget: real("daily_budget"),
  headlines: jsonb("headlines").$type<string[]>().default([]),
  primaryTexts: jsonb("primary_texts").$type<string[]>().default([]),
  descriptions: jsonb("descriptions").$type<string[]>().default([]),
  linkUrl: text("link_url"),
  ctaType: text("cta_type").default("SHOP_NOW"),
  targeting: jsonb("targeting").$type<Record<string, unknown>>().default({}),
  placements: jsonb("placements").$type<string[]>().default([]),
  pixelId: text("pixel_id"),
  optimizationGoal: text("optimization_goal").default("OFFSITE_CONVERSIONS"),
  conversionEvent: text("conversion_event").default("Purchase"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const creatives = pgTable("creatives", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(), // "video" | "image"
  source: text("source").notNull(), // "local" | "gdrive" | "meta"
  metaHash: text("meta_hash"),
  metaVideoId: text("meta_video_id"),
  metaImageHash: text("meta_image_hash"),
  thumbnailUrl: text("thumbnail_url"),
  fileSize: integer("file_size"),
  width: integer("width"),
  height: integer("height"),
  duration: real("duration"),
  tags: jsonb("tags").$type<string[]>().default([]),
  gdriveFileId: text("gdrive_file_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const campaignsCache = pgTable("campaigns_cache", {
  id: text("id").primaryKey(), // Meta campaign ID
  name: text("name").notNull(),
  status: text("status").notNull(),
  objective: text("objective"),
  dailyBudget: real("daily_budget"),
  lifetimeBudget: real("lifetime_budget"),
  budgetRemaining: real("budget_remaining"),
  buyingType: text("buying_type"),
  startTime: timestamp("start_time"),
  stopTime: timestamp("stop_time"),
  createdTime: timestamp("created_time"),
  updatedTime: timestamp("updated_time"),
  syncedAt: timestamp("synced_at").defaultNow().notNull(),
});

export const adsetsCache = pgTable("adsets_cache", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").notNull(),
  name: text("name").notNull(),
  status: text("status").notNull(),
  dailyBudget: real("daily_budget"),
  lifetimeBudget: real("lifetime_budget"),
  targeting: jsonb("targeting").$type<Record<string, unknown>>().default({}),
  optimizationGoal: text("optimization_goal"),
  billingEvent: text("billing_event"),
  bidStrategy: text("bid_strategy"),
  startTime: timestamp("start_time"),
  endTime: timestamp("end_time"),
  syncedAt: timestamp("synced_at").defaultNow().notNull(),
});

export const adsCache = pgTable("ads_cache", {
  id: text("id").primaryKey(),
  adsetId: text("adset_id").notNull(),
  campaignId: text("campaign_id").notNull(),
  name: text("name").notNull(),
  status: text("status").notNull(),
  creativeId: text("creative_id"),
  previewUrl: text("preview_url"),
  syncedAt: timestamp("synced_at").defaultNow().notNull(),
});

export const insights = pgTable("insights", {
  id: serial("id").primaryKey(),
  entityId: text("entity_id").notNull(),
  entityType: text("entity_type").notNull(), // "campaign" | "adset" | "ad"
  dateStart: date("date_start").notNull(),
  dateStop: date("date_stop").notNull(),
  spend: real("spend").default(0),
  impressions: integer("impressions").default(0),
  reach: integer("reach").default(0),
  clicks: integer("clicks").default(0),
  linkClicks: integer("link_clicks").default(0),
  ctr: real("ctr").default(0),
  cpc: real("cpc").default(0),
  cpm: real("cpm").default(0),
  purchases: integer("purchases").default(0),
  purchaseValue: real("purchase_value").default(0),
  roas: real("roas").default(0),
  videoViews3s: integer("video_views_3s").default(0),
  videoAvgWatchTime: real("video_avg_watch_time").default(0),
  videoLength: real("video_length").default(0),
  hookRate: real("hook_rate").default(0),
  holdRate: real("hold_rate").default(0),
  breakdownKey: text("breakdown_key"), // e.g., "age:25-34" or "placement:feed"
  breakdownValue: text("breakdown_value"),
  syncedAt: timestamp("synced_at").defaultNow().notNull(),
});

export const automationRules = pgTable("automation_rules", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  level: text("level").notNull(), // "campaign" | "adset" | "ad"
  conditions: jsonb("conditions").$type<Array<{ metric: string; operator: string; value: number; timeRange: string }>>().notNull(),
  action: jsonb("action").$type<{ type: string; value?: number }>().notNull(),
  cooldownHours: integer("cooldown_hours").default(24),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const ruleExecutions = pgTable("rule_executions", {
  id: serial("id").primaryKey(),
  ruleId: integer("rule_id").notNull(),
  entityId: text("entity_id").notNull(),
  entityType: text("entity_type").notNull(),
  actionTaken: text("action_taken").notNull(),
  details: jsonb("details").$type<Record<string, unknown>>().default({}),
  executedAt: timestamp("executed_at").defaultNow().notNull(),
});

export const uploadJobs = pgTable("upload_jobs", {
  id: serial("id").primaryKey(),
  status: text("status").notNull().default("pending"), // "pending" | "uploading" | "completed" | "failed"
  totalSteps: integer("total_steps").default(5),
  currentStep: integer("current_step").default(0),
  stepLabel: text("step_label"),
  campaignId: text("campaign_id"),
  adsetId: text("adset_id"),
  adId: text("ad_id"),
  creativeId: text("creative_id"),
  config: jsonb("config").$type<Record<string, unknown>>().default({}),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

export const metaConnections = pgTable("meta_connections", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(), // e.g. "ApotekHunden"
  accessToken: text("access_token").notNull(),
  tokenExpiresAt: timestamp("token_expires_at"),
  facebookUserId: text("facebook_user_id"),
  adAccounts: jsonb("ad_accounts").$type<Array<{ id: string; name: string; currency: string; status: number }>>().default([]),
  activeAdAccountId: text("active_ad_account_id"),
  pages: jsonb("pages").$type<Array<{ id: string; name: string }>>().default([]),
  activePageId: text("active_page_id"),
  pixelId: text("pixel_id"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
