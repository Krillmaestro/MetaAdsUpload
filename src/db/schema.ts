import { pgTable, text, integer, real, boolean, timestamp, jsonb, serial, varchar, date, index, uniqueIndex, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ─── Users & Auth ────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  email: text("email").notNull().unique(),
  password: text("password").notNull(), // bcrypt hash
  name: text("name").notNull(),
  role: text("role").notNull().default("editor"), // "admin" | "editor"
  userType: text("user_type").default("editor"), // "video_editor" | "creative_strategist"
  slug: text("slug").unique(), // public vanity slug for /e/[slug] performance page
  publicPagePassword: text("public_page_password"), // optional bcrypt hash to gate the public page
  isActive: boolean("is_active").default(true).notNull(),
  isFounder: boolean("is_founder").default(false).notNull(), // gates the founder time tracker (/time)
  hourlyRate: real("hourly_rate"),
  phone: text("phone"), // E.164, e.g. +46701234567 — used for WhatsApp notifications
  timezone: text("timezone").default("Europe/Stockholm"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Dynamic Option Tables ───────────────────────────────────────────────────

export const angles = pgTable("angles", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull().unique(),
  isActive: boolean("is_active").default(true).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const problems = pgTable("problems", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull().unique(),
  isActive: boolean("is_active").default(true).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const products = pgTable("products", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull().unique(),
  code: text("code").notNull().unique(),
  isActive: boolean("is_active").default(true).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const formats = pgTable("formats", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull().unique(),
  isActive: boolean("is_active").default(true).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const countries = pgTable("countries", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull().unique(),
  code: text("code").notNull().unique(),
  isActive: boolean("is_active").default(true).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const offerTypes = pgTable("offer_types", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull().unique(),
  isActive: boolean("is_active").default(true).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const scriptStructures = pgTable("script_structures", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull().unique(),
  isActive: boolean("is_active").default(true).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const customerAvatars = pgTable("customer_avatars", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull().unique(),
  code: text("code").notNull().unique(),
  description: text("description"),
  isActive: boolean("is_active").default(true).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Assignments ─────────────────────────────────────────────────────────────

export const assignments = pgTable("assignments", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  title: text("title").notNull(),
  description: text("description"),
  batchNumber: integer("batch_number").notNull(),
  version: integer("version").default(1).notNull(),
  formatId: text("format_id"),
  angleId: text("angle_id"),
  productId: text("product_id"),
  countryId: text("country_id"),
  offerTypeId: text("offer_type_id"),
  scriptStructureId: text("script_structure_id"),
  customerAvatarIds: jsonb("customer_avatar_ids").$type<string[]>().default([]),
  landingPage: text("landing_page"),
  assignedToId: text("assigned_to_id").notNull(),
  assignedById: text("assigned_by_id").notNull(),
  creativeStrategistId: text("creative_strategist_id"),
  creativeStrategistName: text("creative_strategist_name"),
  status: text("status").notNull().default("ready_for_editing"),
  // Statuses: ready_for_editing, editing_now, ready_for_review, revision, ready_for_posting, posted
  priority: text("priority").notNull().default("medium"), // low, medium, high, urgent
  dueDate: timestamp("due_date"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  estimatedMinutes: integer("estimated_minutes"),
  videoLengthSeconds: integer("video_length_seconds"),
  briefContent: text("brief_content"), // full brief body (markdown) — replaces Notion
  references: jsonb("references").$type<Array<{ id: string; kind: "url" | "library" | "file"; value: string; label?: string; note?: string }>>().default([]),
  scriptContent: jsonb("script_content").$type<{ hooks: Array<{ id: string; label: string; eng: string; se: string }>; body: { eng: string; se: string } }>(),
  autoName: text("auto_name"),
  revisionFeedback: text("revision_feedback"),
  strategistNotes: text("strategist_notes"),
  deliverableUrl: text("deliverable_url"),
  deliverableR2Key: text("deliverable_r2_key"),
  metaAdId: text("meta_ad_id"),
  metaAdsetId: text("meta_adset_id"),
  metaCampaignId: text("meta_campaign_id"),
  metaPostId: text("meta_post_id"), // effective_object_story_id for post ID preservation
  currentVersionId: text("current_version_id"), // FK → deliverable_versions
  // ─── Learning Loop: the brief is a TEST. Hypothesis goes in here, the
  // result comes back from the ad set(s) it runs in (adset_owners.assignmentId).
  problemId: text("problem_id"),
  hypothesis: text("hypothesis"), // WHY are we making this ad / what do we expect to happen
  variableTested: text("variable_tested"), // the ONE thing this test changes vs. what exists
  adType: text("ad_type"), // "ideation" | "iteration"
  iterationOfId: text("iteration_of_id"), // parent assignment when adType = "iteration"
  awarenessLevel: text("awareness_level"), // unaware | problem_aware | solution_aware | product_aware | most_aware
  publishTemplateId: integer("publish_template_id"), // uploader template (templates.id) this brief publishes with
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("assignments_assigned_to_id_idx").on(table.assignedToId),
  index("assignments_status_idx").on(table.status),
]);

// ─── Time Entries ────────────────────────────────────────────────────────────

export const briefTemplates = pgTable("brief_templates", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  briefContent: text("brief_content"),
  formatId: text("format_id"),
  angleId: text("angle_id"),
  productId: text("product_id"),
  countryId: text("country_id"),
  offerTypeId: text("offer_type_id"),
  scriptStructureId: text("script_structure_id"),
  customerAvatarIds: jsonb("customer_avatar_ids").$type<string[]>().default([]),
  estimatedMinutes: integer("estimated_minutes"),
  priority: text("priority").default("medium"),
  references: jsonb("references").$type<Array<{ id: string; kind: "url" | "library" | "file"; value: string; label?: string; note?: string }>>().default([]),
  scriptContent: jsonb("script_content").$type<{ hooks: Array<{ id: string; label: string; eng: string; se: string }>; body: { eng: string; se: string } }>(),
  // A template is meant to fill the WHOLE form ("Probiotika LP12 + PP" → product,
  // landing, editor, strategist, hypothesis, publish template…), so every
  // assignment field that recurs between briefs lives here too.
  problemId: text("problem_id"),
  landingPage: text("landing_page"),
  assignedToId: text("assigned_to_id"),
  creativeStrategistId: text("creative_strategist_id"),
  creativeStrategistName: text("creative_strategist_name"),
  description: text("description"),
  hypothesis: text("hypothesis"),
  variableTested: text("variable_tested"),
  adType: text("ad_type"),
  awarenessLevel: text("awareness_level"),
  publishTemplateId: integer("publish_template_id"),
  useCount: integer("use_count").default(0).notNull(),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const timeEntries = pgTable("time_entries", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull(),
  assignmentId: text("assignment_id"),
  taskType: text("task_type").notNull(), // new_video, revision, sourcing, static_ad, other
  taskName: text("task_name").notNull(),
  notes: text("notes"),
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time"),
  durationSeconds: integer("duration_seconds"),
  videoOutputSeconds: integer("video_output_seconds"),
  status: text("status").notNull().default("in_progress"), // in_progress, completed
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("time_entries_user_id_idx").on(table.userId),
  index("time_entries_assignment_id_idx").on(table.assignmentId),
  index("time_entries_status_idx").on(table.status),
]);

// ─── Admin Tasks ─────────────────────────────────────────────────────────────
// Lightweight admin-to-admin task board (separate from editor assignments,
// which drive bonuses/stats and are brief-shaped).

export const adminTasks = pgTable("admin_tasks", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  title: text("title").notNull(),
  description: text("description"),
  assignedToId: text("assigned_to_id").notNull(),
  createdById: text("created_by_id").notNull(),
  status: text("status").notNull().default("todo"), // todo, in_progress, done
  priority: text("priority").notNull().default("medium"), // low, medium, high, urgent
  dueDate: timestamp("due_date"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("admin_tasks_assigned_to_id_idx").on(table.assignedToId),
  index("admin_tasks_status_idx").on(table.status),
]);

export const templates = pgTable("templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  isDefault: boolean("is_default").default(false).notNull(),

  // Campaign
  objective: text("objective").default("OUTCOME_SALES"),
  budgetType: text("budget_type").default("ABO"), // ABO or CBO
  dailyBudget: real("daily_budget"), // in `currency` units
  currency: text("currency").default("SEK"), // budget currency — must match the target ad account

  // Ad Copy
  headlines: jsonb("headlines").$type<string[]>().default([]),
  primaryTexts: jsonb("primary_texts").$type<string[]>().default([]),
  descriptions: jsonb("descriptions").$type<string[]>().default([]),
  ctaType: text("cta_type").default("SHOP_NOW"),

  // Landing Pages
  landingPages: jsonb("landing_pages").$type<string[]>().default([]),

  // Targeting
  targetCountries: jsonb("target_countries").$type<string[]>().default(["SE"]),
  ageMin: integer("age_min"),
  ageMax: integer("age_max"),
  genders: jsonb("genders").$type<number[]>(), // [1]=female, [2]=male, [1,2]=all

  // Optimization
  optimizationGoal: text("optimization_goal").default("OFFSITE_CONVERSIONS"),
  conversionEvent: text("conversion_event").default("PURCHASE"),
  bidStrategy: text("bid_strategy").default("LOWEST_COST_WITHOUT_CAP"),

  // Naming Templates
  adsetNameTemplate: text("adset_name_template").default("{product} {angle} {country}"),
  adNameTemplate: text("ad_name_template").default("{country} {editor} {creative} {lp}"),

  // Product / Angle defaults
  productName: text("product_name"),
  angleName: text("angle_name"),

  // Pixel
  pixelId: text("pixel_id"),

  // Ad account this template publishes to ("act_..." or bare id).
  // null = the connection's active/default account. Lets e.g. US templates
  // target the future US ad account while Nordic templates stay on Glimmora.
  adAccountId: text("ad_account_id"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const creatives = pgTable("creatives", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(), // "video" | "image"
  source: text("source").notNull(), // "local" | "gdrive" | "meta" | "r2"
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
  r2Key: text("r2_key"),
  r2Url: text("r2_url"),
  assignmentId: text("assignment_id"),
  editorName: text("editor_name"),
  batchNumber: text("batch_number"),
  status: text("status").default("uploaded"), // uploaded | in_review | approved | archived
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const campaignsCache = pgTable("campaigns_cache", {
  id: text("id").primaryKey(), // Meta campaign ID
  adAccountId: text("ad_account_id"), // "act_..." — which ad account this belongs to
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
}, (table) => [
  index("campaigns_cache_status_idx").on(table.status),
]);

export const adsetsCache = pgTable("adsets_cache", {
  id: text("id").primaryKey(),
  adAccountId: text("ad_account_id"),
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
  createdTime: timestamp("created_time"), // when Meta created the ad set — "days live" starts here
  effectiveStatus: text("effective_status"),
  syncedAt: timestamp("synced_at").defaultNow().notNull(),
}, (table) => [
  index("adsets_cache_campaign_id_idx").on(table.campaignId),
  index("adsets_cache_status_idx").on(table.status),
]);

export const adsCache = pgTable("ads_cache", {
  id: text("id").primaryKey(),
  adAccountId: text("ad_account_id"),
  adsetId: text("adset_id").notNull(),
  campaignId: text("campaign_id").notNull(),
  name: text("name").notNull(),
  status: text("status").notNull(),
  creativeId: text("creative_id"),
  videoId: text("video_id"), // creative's video_id — links ads to library creatives
  imageHash: text("image_hash"), // creative's image_hash — links ads to library creatives
  previewUrl: text("preview_url"),
  syncedAt: timestamp("synced_at").defaultNow().notNull(),
}, (table) => [
  index("ads_cache_adset_id_idx").on(table.adsetId),
  index("ads_cache_campaign_id_idx").on(table.campaignId),
  index("ads_cache_video_id_idx").on(table.videoId),
  index("ads_cache_image_hash_idx").on(table.imageHash),
]);

export const insights = pgTable("insights", {
  id: serial("id").primaryKey(),
  adAccountId: text("ad_account_id"),
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
  videoThruplays: integer("video_thruplays").default(0),
  videoAvgWatchTime: real("video_avg_watch_time").default(0),
  videoLength: real("video_length").default(0),
  hookRate: real("hook_rate").default(0),
  holdRate: real("hold_rate").default(0),
  breakdownKey: text("breakdown_key"), // e.g., "age:25-34" or "placement:feed"
  breakdownValue: text("breakdown_value"),
  newCustomerRevenue: real("new_customer_revenue"), // Shopify new-customer revenue matched to same day
  ncRoas: real("nc_roas"), // newCustomerRevenue / spend
  syncedAt: timestamp("synced_at").defaultNow().notNull(),
}, (table) => [
  index("insights_entity_date_idx").on(table.entityId, table.entityType, table.dateStart),
]);

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
}, (table) => [
  index("automation_rules_enabled_idx").on(table.enabled),
]);

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
  filename: text("filename").notNull().default(""),
  mediaType: text("media_type").default("video"), // "video" | "image"
  status: text("status").notNull().default("pending"), // "pending" | "uploading_r2" | "uploading_meta" | "completed" | "failed"
  totalSteps: integer("total_steps").default(4),
  currentStep: integer("current_step").default(0),
  stepLabel: text("step_label"),
  r2Key: text("r2_key"),
  r2Url: text("r2_url"),
  campaignId: text("campaign_id"),
  adsetId: text("adset_id"),
  adId: text("ad_id"),
  creativeId: text("creative_id"),
  videoId: text("video_id"),
  imageHash: text("image_hash"),
  config: jsonb("config").$type<Record<string, unknown>>().default({}),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

// ─── Editor Payouts ─────────────────────────────────────────────────────────

export const editorPayouts = pgTable("editor_payouts", {
  id: serial("id").primaryKey(),
  editorId: text("editor_id").notNull(), // FK to users
  amount: real("amount").notNull(),
  currency: text("currency").default("USD").notNull(),
  periodFrom: date("period_from").notNull(),
  periodTo: date("period_to").notNull(),
  adIds: jsonb("ad_ids").$type<string[]>().default([]), // which Meta ad IDs earned the bonus
  assignmentIds: jsonb("assignment_ids").$type<string[]>().default([]), // which assignments
  breakdown: jsonb("breakdown").$type<Array<{ adId: string; adName: string; spend: number; roas: number; bonus: number }>>().default([]),
  status: text("status").notNull().default("pending"), // "pending" | "paid"
  notes: text("notes"),
  paidAt: timestamp("paid_at"),
  paidById: text("paid_by_id"), // admin who marked as paid
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("editor_payouts_editor_id_idx").on(table.editorId),
  index("editor_payouts_status_idx").on(table.status),
]);

// ─── Ad Ownership ───────────────────────────────────────────────────────────
// Direct mapping of a Meta ad → its owning video editor (bonus owner) and the
// creative strategist (tracked for stats only). Set either at upload time or via
// the one-click "Owner" button in the Ad Set / Creative Analyzer. This is the
// PRIMARY source of truth for attributing ad performance to a team member,
// replacing the fragile "parse editor name from ad name" heuristic.

export const adOwners = pgTable("ad_owners", {
  adId: text("ad_id").primaryKey(), // Meta ad ID
  videoEditorId: text("video_editor_id"), // FK users — earns the bonus
  creativeStrategistId: text("creative_strategist_id"), // FK users — stats only, no bonus
  campaignId: text("campaign_id"),
  adsetId: text("adset_id"),
  adName: text("ad_name"),
  // Creative metadata — what the ad is about, for per-editor pattern tracking
  angle: text("angle"), // e.g. "Trötthet", "Klåda", "Pris"
  problem: text("problem"), // the pain/problem the creative addresses
  // Which uploader template produced this ad (for best/worst-template analytics)
  templateId: integer("template_id"),
  templateName: text("template_name"),
  // Forced outcome when an ad set is sent to the Graveyard
  graveyardOutcome: text("graveyard_outcome"), // "spend_winner" | "loser"
  graveyardAt: timestamp("graveyard_at"),
  source: text("source").default("analyzer"), // "uploader" | "analyzer" | "import"
  assignedById: text("assigned_by_id"), // admin who set the owner
  // ─── Learning Loop, creative level ───
  // In CBO scaling campaigns one ad set holds the winners from many briefs,
  // so the loop has to close per CREATIVE too. These mirror adset_owners'
  // loop columns; an ad without its own link inherits its ad set's.
  assignmentId: text("assignment_id"),
  linkSource: text("link_source"), // "auto" | "manual"
  linkedAt: timestamp("linked_at"),
  hookLabel: text("hook_label"), // "H2" — which hook variant of the brief's script this ad is
  script: text("script"), // the creative's own script text when it is not (only) the brief's
  // The ORIGINAL ad set this creative was tested in. A copy inside a CBO
  // scaling container ("Scaling Winners - POSTID") credits its result to the
  // ABO ad set it won in, so the loop closes on the test, not the container.
  // Resolved from names/video ids at read time; this column is the manual override.
  originAdsetId: text("origin_adset_id"),
  originSource: text("origin_source"), // "manual" | null
  verdict: text("verdict"), // "confirmed_winner" | "loser" | "iterate" | "inconclusive" | null
  verdictAt: timestamp("verdict_at"),
  learnings: text("learnings"),
  learningsAt: timestamp("learnings_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("ad_owners_video_editor_idx").on(table.videoEditorId),
  index("ad_owners_strategist_idx").on(table.creativeStrategistId),
  index("ad_owners_template_idx").on(table.templateId),
  index("ad_owners_assignment_idx").on(table.assignmentId),
]);

// ─── Ad Set Ownership ───────────────────────────────────────────────────────
// The bonus unit is the AD SET (not the individual ad). An ad set is assigned to
// a video editor (+ strategist); the bonus is computed on the ad set's aggregate
// lifetime spend + blended ROAS. Per-ad metadata (angle/problem/template) stays
// in ad_owners for the per-ad drill-down.

export const adsetOwners = pgTable("adset_owners", {
  adsetId: text("adset_id").primaryKey(), // Meta ad set ID
  videoEditorId: text("video_editor_id"), // FK users — earns the bonus
  creativeStrategistId: text("creative_strategist_id"), // FK users — stats only
  campaignId: text("campaign_id"),
  adsetName: text("adset_name"),
  // Set-level creative tags — every ad in the set inherits these unless the ad
  // has its own ad_owners tag (ad-level overrides set-level).
  angle: text("angle"),
  problem: text("problem"),
  // Read from the ad set name by the parser (src/lib/adset-name.ts).
  format: text("format"), // VSL | UGC | STATIC | ANIME | NON_NARRATED
  landing: text("landing"), // "LP6 + LP12"
  country: text("country"),
  batch: text("batch"),
  // Which fields the parser last wrote. A field NOT listed here was set by a
  // human and is never overwritten by a later run.
  autoFields: jsonb("auto_fields").$type<string[]>().default([]),
  autoAssignedAt: timestamp("auto_assigned_at"),
  // Manual verdict, independent of the window-based auto-classification
  verdict: text("verdict"), // "confirmed_winner" | "loser" | "iterate" | "inconclusive" | null
  verdictAt: timestamp("verdict_at"),
  graveyardOutcome: text("graveyard_outcome"), // "spend_winner" | "loser"
  graveyardAt: timestamp("graveyard_at"),
  source: text("source").default("analyzer"), // "uploader" | "analyzer"
  assignedById: text("assigned_by_id"),
  backfilledAt: timestamp("backfilled_at"), // lifetime insights pulled from Meta (set once)
  // ─── Learning Loop ───
  // The brief this ad set runs. Many ad sets (testing set, scaling copy,
  // graveyard copy) point at ONE assignment, so the creative's true lifetime
  // result is the sum over all of them.
  assignmentId: text("assignment_id"),
  linkSource: text("link_source"), // "publish" | "auto" | "manual"
  linkedAt: timestamp("linked_at"),
  learnings: text("learnings"), // what we learned — the whole point of the loop
  learningsAt: timestamp("learnings_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("adset_owners_video_editor_idx").on(table.videoEditorId),
  index("adset_owners_strategist_idx").on(table.creativeStrategistId),
  index("adset_owners_assignment_idx").on(table.assignmentId),
]);

// ─── Ad Bonus Ledger (lifetime, locked once) ────────────────────────────────
// NOTE: keyed by AD SET id (stored in the adId column) since the bonus unit is
// the ad set. One row per owned ad set.
// One row per qualifying ad. When an ad first crosses a bonus tier (on lifetime
// cumulative spend + ROAS) the earned amount is locked in and never decreases,
// even if you change the date filter or ROAS later dips. If the ad later climbs
// to a higher tier, earnedBonus is bumped up (you owe the delta). paidAmount
// tracks what has actually been paid out so outstanding = earnedBonus - paidAmount.

export const adBonuses = pgTable("ad_bonuses", {
  id: serial("id").primaryKey(),
  adId: text("ad_id").notNull().unique(), // Meta ad ID
  editorId: text("editor_id").notNull(), // video editor who earned it
  earnedBonus: real("earned_bonus").default(0).notNull(), // highest tier $ ever reached (locked)
  earnedTier: integer("earned_tier").default(0).notNull(), // 0 | 10 | 20 | 30 | 50
  tierLog: jsonb("tier_log").$type<Record<string, string>>().default({}), // { "10": "2026-06-05", ... } first date each tier was reached (grows only)
  paidAmount: real("paid_amount").default(0).notNull(), // sum already paid out for this ad
  peakSpend: real("peak_spend").default(0).notNull(), // lifetime spend at last evaluation
  peakRoas: real("peak_roas").default(0).notNull(), // lifetime ROAS at last evaluation
  firstQualifiedAt: timestamp("first_qualified_at"),
  lastEvaluatedAt: timestamp("last_evaluated_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("ad_bonuses_editor_idx").on(table.editorId),
  index("ad_bonuses_status_idx").on(table.adId),
]);

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
  // Custom audiences to auto-exclude on every new ad set, keyed by ad account id.
  // e.g. { "act_261297039993717": ["120250065842190350"] }
  defaultExclusions: jsonb("default_exclusions").$type<Record<string, string[]>>().default({}),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Review System ──────────────────────────────────────────────────────────

export const deliverableVersions = pgTable("deliverable_versions", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  assignmentId: text("assignment_id").notNull(),
  versionNumber: integer("version_number").notNull().default(1),
  r2Key: text("r2_key").notNull(),
  r2Url: text("r2_url").notNull(),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  fileSize: integer("file_size"),
  width: integer("width"),
  height: integer("height"),
  duration: real("duration"),
  thumbnailR2Key: text("thumbnail_r2_key"),
  thumbnailUrl: text("thumbnail_url"),
  uploadedById: text("uploaded_by_id").notNull(),
  reviewStatus: text("review_status").notNull().default("no_status"),
  // no_status | in_progress | needs_review | approved
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("dv_assignment_idx").on(table.assignmentId),
  index("dv_version_idx").on(table.assignmentId, table.versionNumber),
]);

export const reviewComments = pgTable("review_comments", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  deliverableVersionId: text("deliverable_version_id").notNull(),
  parentCommentId: text("parent_comment_id"), // null=root, set=reply
  authorId: text("author_id"), // null for guest comments
  guestName: text("guest_name"), // for share link reviewers
  body: text("body").notNull(),
  timecodeSeconds: real("timecode_seconds"), // null=general comment
  annotation: jsonb("annotation"),
  isInternal: boolean("is_internal").default(true).notNull(),
  isResolved: boolean("is_resolved").default(false).notNull(),
  reactions: jsonb("reactions").$type<Record<string, string[]>>().default({}),
  mentionedUserIds: jsonb("mentioned_user_ids").$type<string[]>().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("rc_version_idx").on(table.deliverableVersionId),
  index("rc_parent_idx").on(table.parentCommentId),
]);

// ─── Evolve Framework ────────────────────────────────────────────────────────

export const evolveSettings = pgTable("evolve_settings", {
  id: serial("id").primaryKey(),
  targetRoas: real("target_roas").default(2.0).notNull(),
  holdRoas: real("hold_roas").default(1.7).notNull(),
  breakevenRoas: real("breakeven_roas").default(1.42).notNull(),
  targetCpa: real("target_cpa").default(30).notNull(),
  minDailySpend: real("min_daily_spend").default(50).notNull(),
  sekPerUsd: real("sek_per_usd").default(10.5).notNull(), // FX rate: spend (SEK) → USD for bonus thresholds
  bonusTiers: jsonb("bonus_tiers").$type<Array<{ minSpend: number; minRoas: number; bonus: number }>>().default([]), // editable editor bonus tiers; empty = use code defaults
  learningPeriodDays: integer("learning_period_days").default(7).notNull(),
  scalingProtocolDays: integer("scaling_protocol_days").default(3).notNull(),
  zombieCostCapDiscount: real("zombie_cost_cap_discount").default(0.20).notNull(),
  maxAdSetsPerCampaign: integer("max_ad_sets_per_campaign").default(5).notNull(),
  surfModeEnabled: boolean("surf_mode_enabled").default(false).notNull(),
  surfModeCampaignIds: text("surf_mode_campaign_ids"),
  surfIntervalHours: integer("surf_interval_hours").default(4).notNull(),
  graveyardCampaignId: text("graveyard_campaign_id"),
  graveyardMappings: text("graveyard_mappings"), // JSON: { "cboCampaignId": "graveyardCampaignId", ... }
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const adClassifications = pgTable("ad_classifications", {
  id: serial("id").primaryKey(),
  adId: text("ad_id").notNull(),
  classification: text("classification").notNull(), // breakthrough | spend_winner | kpi_winner | loser | new
  spend: real("spend").default(0),
  roas: real("roas").default(0),
  cpa: real("cpa").default(0),
  purchases: integer("purchases").default(0),
  recommendation: text("recommendation"),
  actionTaken: text("action_taken"),
  actionTakenAt: timestamp("action_taken_at"),
  campaignId: text("campaign_id"),
  adsetId: text("adset_id"),
  dateRangeStart: text("date_range_start"),
  dateRangeEnd: text("date_range_end"),
  classifiedAt: timestamp("classified_at").defaultNow().notNull(),
}, (table) => [
  index("ad_classifications_ad_id_idx").on(table.adId),
  index("ad_classifications_classification_idx").on(table.classification),
]);

export const scalingProtocolLog = pgTable("scaling_protocol_log", {
  id: serial("id").primaryKey(),
  entityId: text("entity_id").notNull(),
  entityType: text("entity_type").notNull(), // adset | campaign
  status: text("status").notNull().default("monitoring"), // scaling | decreasing | holding | monitoring
  consecutiveDaysAboveTarget: integer("consecutive_days_above_target").default(0).notNull(),
  consecutiveDaysBelowBreakeven: integer("consecutive_days_below_breakeven").default(0).notNull(),
  lastAction: text("last_action"),
  lastActionAt: timestamp("last_action_at"),
  enteredAt: timestamp("entered_at").defaultNow().notNull(),
  exitedAt: timestamp("exited_at"),
}, (table) => [
  index("scaling_protocol_entity_idx").on(table.entityId, table.entityType),
]);

export const auditResults = pgTable("audit_results", {
  id: serial("id").primaryKey(),
  category: text("category").notNull(), // structure | zombie | budget | frequency | attribution | ad_count
  severity: text("severity").notNull(), // pass | warning | fail
  title: text("title").notNull(),
  description: text("description"),
  entityId: text("entity_id"),
  entityType: text("entity_type"),
  details: jsonb("details").$type<Record<string, unknown>>().default({}),
  auditedAt: timestamp("audited_at").defaultNow().notNull(),
});

// ─── Review System ──────────────────────────────────────────────────────────

export const shareLinks = pgTable("share_links", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  assignmentId: text("assignment_id").notNull(),
  token: text("token").notNull().unique(),
  password: text("password"), // bcrypt hash, null=no password
  expiresAt: timestamp("expires_at"),
  createdById: text("created_by_id").notNull(),
  allowComments: boolean("allow_comments").default(true).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  accessCount: integer("access_count").default(0).notNull(),
  lastAccessedAt: timestamp("last_accessed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("sl_token_idx").on(table.token),
  index("sl_assignment_idx").on(table.assignmentId),
]);

// ─── Strategy Framework ─────────────────────────────────────────────────────

export const strategyDesires = pgTable("strategy_desires", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  description: text("description"),
  sortOrder: integer("sort_order").default(0).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const strategySubAvatars = pgTable("strategy_sub_avatars", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  desireId: text("desire_id").notNull(),
  name: text("name").notNull(),
  behavior: text("behavior"),
  sortOrder: integer("sort_order").default(0).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("strategy_sub_avatars_desire_id_idx").on(table.desireId),
]);

export const strategyAngles = pgTable("strategy_angles", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  subAvatarId: text("sub_avatar_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  sortOrder: integer("sort_order").default(0).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("strategy_angles_sub_avatar_id_idx").on(table.subAvatarId),
]);

export const creativeRoadmap = pgTable("creative_roadmap", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  batchNumber: integer("batch_number"),
  conceptName: text("concept_name").notNull(),
  authorId: text("author_id"),
  desireId: text("desire_id"),
  subAvatarId: text("sub_avatar_id"),
  angleId: text("angle_id"),
  awarenessLevel: text("awareness_level"), // unaware | problem_aware | solution_aware | product_aware | most_aware
  fileType: text("file_type"), // video | image | carousel
  status: text("status").notNull().default("ideation"), // ideation | in_production | uploaded | learning | breakthrough | loser
  hypothesis: text("hypothesis"),
  variableTested: text("variable_tested"),
  whatHappened: text("what_happened"),
  whatWeLearned: text("what_we_learned"),
  metaAdId: text("meta_ad_id"),
  assignmentId: text("assignment_id"),
  adType: text("ad_type"), // "ideation" | "iteration"
  breakthroughMemo: text("breakthrough_memo"),
  linkToBrief: text("link_to_brief"),
  linkToAd: text("link_to_ad"),
  upvotes: integer("upvotes").default(0).notNull(),
  lastClassification: text("last_classification"),
  lastSpend: real("last_spend"),
  lastRoas: real("last_roas"),
  lastCpa: real("last_cpa"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("creative_roadmap_status_idx").on(table.status),
  index("creative_roadmap_author_id_idx").on(table.authorId),
  index("creative_roadmap_meta_ad_id_idx").on(table.metaAdId),
  index("creative_roadmap_desire_id_idx").on(table.desireId),
]);

// ─── Shopify ncROAS ─────────────────────────────────────────────────────────

export const shopifyOrders = pgTable("shopify_orders", {
  id: serial("id").primaryKey(),
  shopifyOrderId: text("shopify_order_id").notNull().unique(),
  orderDate: date("order_date").notNull(),
  totalPrice: real("total_price").notNull(),
  isNewCustomer: boolean("is_new_customer").notNull(),
  customerId: text("customer_id"),
  customerEmail: text("customer_email"),

  // UTM attribution (from note_attributes)
  utmCampaign: text("utm_campaign"),   // Meta campaign ID
  utmAdset: text("utm_adset"),         // Meta ad set ID (utm_term)
  utmAd: text("utm_ad"),              // Meta ad ID (utm_content)
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),

  syncedAt: timestamp("synced_at").defaultNow().notNull(),
}, (table) => [
  index("shopify_orders_date_idx").on(table.orderDate),
  index("shopify_orders_adset_idx").on(table.utmAdset),
  index("shopify_orders_campaign_idx").on(table.utmCampaign),
  index("shopify_orders_date_adset_idx").on(table.orderDate, table.utmAdset),
]);

export const shopifyDailyStats = pgTable("shopify_daily_stats", {
  id: serial("id").primaryKey(),
  date: date("date").notNull().unique(),
  totalOrders: integer("total_orders").default(0),
  totalRevenue: real("total_revenue").default(0),
  newCustomerOrders: integer("new_customer_orders").default(0),
  newCustomerRevenue: real("new_customer_revenue").default(0),
  returningCustomerOrders: integer("returning_customer_orders").default(0),
  returningCustomerRevenue: real("returning_customer_revenue").default(0),
  syncedAt: timestamp("synced_at").defaultNow().notNull(),
});

// ─── Founder Time Tracking ───────────────────────────────────────────────────
// Separate from `time_entries` (which powers editor scorecards + bonuses) so
// founder hours never pollute editor stats.

export const workCategories = pgTable("work_categories", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull().unique(),
  color: text("color").notNull().default("#38bdf8"), // hex, used directly by charts/chips
  isActive: boolean("is_active").default(true).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const workBrands = pgTable("work_brands", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull().unique(),
  color: text("color").notNull().default("#a78bfa"),
  isActive: boolean("is_active").default(true).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const workSessions = pgTable("work_sessions", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull(),
  categoryId: text("category_id").notNull(),
  brandId: text("brand_id"),
  task: text("task"), // optional short label set when starting
  note: text("note"), // REQUIRED on stop — what actually got done
  startedAt: timestamp("started_at").notNull(),
  endedAt: timestamp("ended_at"),
  // Server-authoritative clock: elapsed = accumulatedSeconds + (running ? now - segmentStartedAt : 0)
  segmentStartedAt: timestamp("segment_started_at"),
  accumulatedSeconds: integer("accumulated_seconds").default(0).notNull(),
  durationSeconds: integer("duration_seconds"), // final, set on stop
  status: text("status").notNull().default("running"), // running | paused | done
  source: text("source").notNull().default("timer"), // timer | manual
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("work_sessions_user_id_idx").on(table.userId),
  index("work_sessions_started_at_idx").on(table.startedAt),
  index("work_sessions_category_id_idx").on(table.categoryId),
  index("work_sessions_status_idx").on(table.status),
]);

// ─── LogRocket snapshots ─────────────────────────────────────────────────────
// Every LogRocket pull is stored whole and never overwritten, so the /logrocket
// page can show any earlier version and diff the current one against it. The
// payload is validated against `payloadSchema` (src/lib/logrocket-types.ts)
// before it lands here, which is what lets an old row still render after the
// shape grows.

export const logrocketSnapshots = pgTable("logrocket_snapshots", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  // Optional human name for the pull ("efter ears1-fixen").
  label: text("label"),
  source: text("source").notNull().default("manual"), // mcp | manual | seed
  // Denormalised off the payload so the version picker sorts without parsing json.
  windowStart: text("window_start").notNull(),
  windowEnd: text("window_end").notNull(),
  payload: jsonb("payload").$type<import("@/lib/logrocket-types").LogRocketPayload>().notNull(),
  createdBy: text("created_by"),
  createdByName: text("created_by_name"),
  capturedAt: timestamp("captured_at").defaultNow().notNull(),
}, (table) => [
  index("logrocket_snapshots_captured_at_idx").on(table.capturedAt),
  // Exactly one seed row, so the auto-seed on an empty table stays idempotent
  // even if two requests race it.
  uniqueIndex("logrocket_snapshots_single_seed_idx")
    .on(table.source)
    .where(sql`${table.source} = 'seed'`),
]);
