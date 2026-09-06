// Upload-to-Meta as a job that cannot be lost.
//
// A job walks through short, idempotent steps and saves its state after every
// Meta call. Any driver may run it — the dialog polling, the server chaining
// itself after a response, the assignments board on load, or the worker on
// GitHub every five minutes — and none of them can create anything twice:
// before creating a campaign, ad set or ad we look for one with the same
// name, and media ids are saved the moment Meta returns them. Errors are
// retried with backoff; errors Meta says are our fault stop the job with a
// message and a Retry button.
import { db, schema } from "@/db";
import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { createCampaign, getCampaigns } from "@/lib/meta/campaigns";
import { createAdSet, getAdSets } from "@/lib/meta/adsets";
import { createAd, getAdPostId, getAds } from "@/lib/meta/ads";
import { createAdCreative, uploadImage, getVideoThumbnail } from "@/lib/meta/creatives";
import { metaApi, getAdAccountId, getPageId, getPixelId, MetaApiError } from "@/lib/meta/client";
import { applyLinks } from "@/lib/learning-loop/link";
import { listDeliverableFiles, APPROVED } from "@/lib/deliverables";
import type { PublishJobState } from "@/db/schema";

export type PublishJob = typeof schema.publishJobs.$inferSelect;

export interface PublishConfig {
  campaignId?: string;
  campaignName?: string;
  campaignObjective?: string;
  budgetType?: "ABO" | "CBO";
  adsetName?: string;
  dailyBudget?: number; // cents
  targeting?: Record<string, unknown>;
  optimizationGoal?: string;
  conversionEvent?: string;
  bidStrategy?: string;
  templateId?: number;
  headlines?: string[];
  primaryTexts?: string[];
  descriptions?: string[];
  ctaType?: string;
  landingPages: string[];
  versionIds?: string[];
  sourcePostId?: string;
}

export const STEP_ORDER = ["preflight", "campaign", "adset", "media", "ads", "finalize", "done"] as const;
export const STEP_LABELS: Record<string, string> = {
  preflight: "Checking token, campaign and files",
  campaign: "Campaign",
  adset: "Ad set",
  media: "Uploading media to Meta",
  ads: "Creating ads",
  finalize: "Saving to the app",
  done: "Done",
};
const ACTIVE = ["queued", "running", "waiting"];
const MAX_ATTEMPTS = 12;
const LOCK_STALE_MS = 2 * 60 * 1000;

const backoffMs = (attempt: number) => Math.min(15_000 * 2 ** Math.max(0, attempt - 1), 10 * 60 * 1000);
const isImage = (name: string) => /\.(jpg|jpeg|png|webp)$/i.test(name);
const adNameFor = (fileName: string, lpIdx: number, lpCount: number) => `${fileName.replace(/\.[^.]+$/, "").replace(/^\d{10,}-/, "")}${lpCount > 1 ? ` LP${lpIdx + 1}` : ""}`;

/** Meta errors that retrying will not fix: bad parameters, permissions, policy. */
function isPermanent(err: unknown): boolean {
  if (err instanceof MetaApiError) {
    const code = err.metaErrorCode;
    if (code && [100, 10, 200, 294, 1487, 2061015, 1885, 1885374, 1885852, 190].includes(code)) return true;
  }
  const m = err instanceof Error ? err.message : String(err);
  return /\(#(100|10|200|190)\)|Invalid parameter|permission|does not exist|Unsupported post request/i.test(m);
}

function pushLog(state: PublishJobState, msg: string) {
  state.log = [...(state.log ?? []).slice(-59), { at: new Date().toISOString(), msg }];
}

async function save(job: PublishJob, patch: Partial<typeof schema.publishJobs.$inferInsert>) {
  const [row] = await db.update(schema.publishJobs).set({ ...patch, updatedAt: new Date() }).where(eq(schema.publishJobs.id, job.id)).returning();
  Object.assign(job, row);
  return job;
}

/** Progress numbers the UI shows. */
export function progressOf(job: PublishJob) {
  const s = job.state ?? {};
  const files = s.files ?? [];
  const media = files.filter((f) => s.media?.[f.versionId]?.ready).length;
  const adsDone = Object.keys(s.ads ?? {}).length;
  const adsTotal = files.length * (s.landingPages?.length ?? 0);
  const stepIdx = Math.max(0, STEP_ORDER.indexOf(job.step as (typeof STEP_ORDER)[number]));
  return { step: job.step, stepIndex: stepIdx, steps: STEP_ORDER.length - 1, files: files.length, mediaReady: media, adsDone, adsTotal, campaignId: s.campaignId, adsetId: s.adsetId, adsetName: s.adsetName, ads: Object.values(s.ads ?? {}), log: s.log ?? [] };
}

// ── creating a job ────────────────────────────────────────────────────────
export async function createPublishJob(assignmentId: string, config: PublishConfig, userId: string | null): Promise<{ job: PublishJob; existing: boolean }> {
  const [assignment] = await db.select().from(schema.assignments).where(eq(schema.assignments.id, assignmentId));
  if (!assignment) throw new Error("Assignment not found");
  if (assignment.status !== "ready_for_posting") throw new Error("Assignment must be in 'ready_for_posting' status");
  if (!config.landingPages?.length) throw new Error("At least one landing page is required");

  const [running] = await db.select().from(schema.publishJobs).where(and(eq(schema.publishJobs.assignmentId, assignmentId), inArray(schema.publishJobs.status, ACTIVE))).orderBy(desc(schema.publishJobs.createdAt)).limit(1);
  if (running) return { job: running, existing: true };

  const files = await listDeliverableFiles(assignmentId);
  const wanted = config.versionIds?.length ? new Set(config.versionIds) : null;
  const selected = files.filter((f) => (wanted ? wanted.has(f.id) : f.reviewStatus === APPROVED && !f.metaAdId));
  const notApproved = selected.filter((f) => f.reviewStatus !== APPROVED);
  if (notApproved.length) throw new Error(`${notApproved.map((f) => f.hookLabel ?? f.filename).join(", ")} är inte godkänd`);
  if (!selected.length) throw new Error("No approved files to upload");

  const state: PublishJobState = {
    files: selected.map((f) => ({ versionId: f.id, name: f.filename, type: isImage(f.filename) ? "image" : "video", url: f.r2Url, hookLabel: f.hookLabel })),
    landingPages: config.landingPages.map((l) => l.trim()).filter(Boolean),
    media: {}, ads: {}, log: [],
  };
  pushLog(state, `Job created: ${state.files!.length} files × ${state.landingPages!.length} landing pages`);
  const [job] = await db.insert(schema.publishJobs).values({
    assignmentId, createdById: userId, config: config as unknown as Record<string, unknown>, state, status: "queued", step: "preflight",
    totalAds: state.files!.length * state.landingPages!.length, nextRunAt: new Date(),
  }).returning();
  return { job, existing: false };
}

// ── running ───────────────────────────────────────────────────────────────
/**
 * Take the lock and do as many steps as fit in the budget. Returns the job as
 * it is afterwards. Safe to call from anywhere at any time.
 */
export async function runJob(jobId: string, budgetMs = 40_000): Promise<PublishJob | null> {
  const token = crypto.randomUUID();
  const staleBefore = new Date(Date.now() - LOCK_STALE_MS);
  const [locked] = await db.update(schema.publishJobs)
    .set({ lockedAt: new Date(), lockToken: token, status: "running", updatedAt: new Date() })
    .where(and(
      eq(schema.publishJobs.id, jobId),
      inArray(schema.publishJobs.status, ACTIVE),
      or(isNull(schema.publishJobs.lockedAt), lt(schema.publishJobs.lockedAt, staleBefore)),
      or(isNull(schema.publishJobs.nextRunAt), sql`${schema.publishJobs.nextRunAt} <= now()`),
    ))
    .returning();
  if (!locked) {
    const [current] = await db.select().from(schema.publishJobs).where(eq(schema.publishJobs.id, jobId));
    return current ?? null;
  }
  const job = locked;
  const deadline = Date.now() + budgetMs;
  try {
    while (Date.now() < deadline && job.step !== "done") {
      const outcome = await step(job, deadline);
      if (outcome === "waiting") { await save(job, { status: "waiting", lockedAt: null, lockToken: null }); return job; }
      if (outcome === "done") break;
    }
    if (job.step === "done") await save(job, { status: "done", lockedAt: null, lockToken: null, finishedAt: new Date(), lastError: null });
    else await save(job, { status: "queued", lockedAt: null, lockToken: null, nextRunAt: new Date() }); // budget used up — continue on the next run
  } catch (err) {
    const msg = (err instanceof Error ? err.message : String(err)).slice(0, 900);
    const attempts = (job.attempts ?? 0) + 1;
    const permanent = isPermanent(err) || attempts >= MAX_ATTEMPTS;
    const state = { ...(job.state ?? {}) } as PublishJobState;
    pushLog(state, `${permanent ? "Stopped" : `Retry ${attempts}`} at ${job.step}: ${msg}`);
    await save(job, {
      state, attempts, lastError: msg, lockedAt: null, lockToken: null,
      status: permanent ? "failed" : "waiting",
      nextRunAt: permanent ? null : new Date(Date.now() + backoffMs(attempts)),
    });
  }
  return job;
}

/** Runs every job that is due. Used by the board on load, the cron and the GitHub worker. */
export async function resumeRunnable(budgetMs = 45_000, limit = 5): Promise<PublishJob[]> {
  const staleBefore = new Date(Date.now() - LOCK_STALE_MS);
  const due = await db.select({ id: schema.publishJobs.id }).from(schema.publishJobs)
    .where(and(
      inArray(schema.publishJobs.status, ACTIVE),
      or(isNull(schema.publishJobs.lockedAt), lt(schema.publishJobs.lockedAt, staleBefore)),
      or(isNull(schema.publishJobs.nextRunAt), sql`${schema.publishJobs.nextRunAt} <= now()`),
    ))
    .orderBy(schema.publishJobs.createdAt).limit(limit);
  const out: PublishJob[] = [];
  const deadline = Date.now() + budgetMs;
  for (const { id } of due) {
    const left = deadline - Date.now();
    if (left < 8_000) break;
    const j = await runJob(id, Math.min(left, 40_000));
    if (j) out.push(j);
  }
  return out;
}

export async function retryJob(jobId: string): Promise<PublishJob | null> {
  const [job] = await db.update(schema.publishJobs).set({ status: "queued", attempts: 0, lastError: null, nextRunAt: new Date(), lockedAt: null, lockToken: null, updatedAt: new Date() }).where(eq(schema.publishJobs.id, jobId)).returning();
  return job ?? null;
}

export async function latestJobFor(assignmentId: string): Promise<PublishJob | null> {
  const [job] = await db.select().from(schema.publishJobs).where(eq(schema.publishJobs.assignmentId, assignmentId)).orderBy(desc(schema.publishJobs.createdAt)).limit(1);
  return job ?? null;
}

// ── the steps ─────────────────────────────────────────────────────────────
type Outcome = "advanced" | "waiting" | "done";

async function step(job: PublishJob, deadline: number): Promise<Outcome> {
  const cfg = job.config as unknown as PublishConfig;
  const state = { ...(job.state ?? {}) } as PublishJobState;
  const commit = async (nextStep?: string) => save(job, { state, step: nextStep ?? job.step, attempts: nextStep ? 0 : job.attempts, lastError: nextStep ? null : job.lastError });

  switch (job.step) {
    case "preflight": {
      const [assignment] = await db.select().from(schema.assignments).where(eq(schema.assignments.id, job.assignmentId));
      if (!assignment) throw new Error("Assignment not found");
      const acct = await getAdAccountId();
      await metaApi(`/${acct}`, { params: { fields: "id" } }); // token + account alive
      state.pageId = await getPageId();
      state.pixelId = (await getPixelId()) ?? undefined;
      // copy
      let headlines = cfg.headlines ?? [], primaryTexts = cfg.primaryTexts ?? [], descriptions = cfg.descriptions ?? [], ctaType = cfg.ctaType || "SHOP_NOW";
      if (cfg.templateId) {
        const [t] = await db.select().from(schema.templates).where(eq(schema.templates.id, cfg.templateId));
        if (t) {
          if (!headlines.length) headlines = (t.headlines as string[]) || [];
          if (!primaryTexts.length) primaryTexts = (t.primaryTexts as string[]) || [];
          if (!descriptions.length) descriptions = (t.descriptions as string[]) || [];
          ctaType = t.ctaType || ctaType;
        }
      }
      state.copy = { headlines, primaryTexts, descriptions, ctaType };
      // campaign
      if (cfg.campaignId) {
        const c = await metaApi<{ id: string; name?: string; daily_budget?: string; lifetime_budget?: string }>(`/${cfg.campaignId}`, { params: { fields: "id,name,daily_budget,lifetime_budget" } });
        state.campaignId = c.id; state.campaignName = c.name;
        state.budgetType = c.daily_budget || c.lifetime_budget ? "CBO" : (cfg.budgetType ?? "ABO");
      } else {
        state.budgetType = cfg.budgetType ?? "ABO";
      }
      // files reachable
      for (const f of state.files ?? []) {
        const h = await fetch(f.url, { method: "HEAD" });
        if (!h.ok) throw new Error(`File not reachable: ${f.name} (${h.status})`);
      }
      const country = assignment.countryId ? (await db.select().from(schema.countries).where(eq(schema.countries.id, assignment.countryId)))[0] : null;
      state.adsetName = cfg.adsetName || assignment.autoName || assignment.title;
      pushLog(state, `Preflight ok · ${state.files?.length} files · ${state.budgetType} · page ${state.pageId}`);
      (state as PublishJobState & { countryCode?: string }).countryCode = country?.code || "SE";
      await commit("campaign");
      return "advanced";
    }

    case "campaign": {
      if (!state.campaignId) {
        const name = cfg.campaignName || `${(state as PublishJobState & { countryCode?: string }).countryCode ?? "SE"} ${state.adsetName}`;
        const existing = (await getCampaigns(200)).find((c) => c.name === name);
        if (existing) { state.campaignId = existing.id; pushLog(state, `Campaign reused: ${name}`); }
        else {
          const c = await createCampaign({ name, objective: cfg.campaignObjective || "OUTCOME_SALES", status: "PAUSED", daily_budget: state.budgetType === "CBO" ? (cfg.dailyBudget || 50000) : undefined });
          state.campaignId = c.id; pushLog(state, `Campaign created: ${name}`);
        }
        state.campaignName = name;
      }
      await commit("adset");
      return "advanced";
    }

    case "adset": {
      if (!state.adsetId) {
        const existing = (await getAdSets(state.campaignId!, 200)).find((a) => a.name === state.adsetName);
        if (existing) { state.adsetId = existing.id; pushLog(state, `Ad set reused: ${state.adsetName}`); }
        else {
          const cc = (state as PublishJobState & { countryCode?: string }).countryCode ?? "SE";
          const adset = await createAdSet({
            campaign_id: state.campaignId!, name: state.adsetName!,
            daily_budget: state.budgetType !== "CBO" ? (cfg.dailyBudget || 5000) : undefined,
            targeting: cfg.targeting || { geo_locations: { countries: [cc] } },
            optimization_goal: cfg.optimizationGoal || "OFFSITE_CONVERSIONS", billing_event: "IMPRESSIONS",
            bid_strategy: cfg.bidStrategy || "LOWEST_COST_WITHOUT_CAP", status: "PAUSED",
            promoted_object: state.pixelId ? { pixel_id: state.pixelId, custom_event_type: cfg.conversionEvent || "PURCHASE" } : undefined,
            url_tags: "utm_source=fb&utm_medium=paid&utm_campaign={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}",
          });
          state.adsetId = adset.id; pushLog(state, `Ad set created: ${state.adsetName}`);
        }
      }
      await commit(cfg.sourcePostId ? "ads" : "media");
      return "advanced";
    }

    case "media": {
      state.media ??= {};
      // start uploads that have not started
      for (const f of state.files ?? []) {
        if (state.media[f.versionId]?.videoId || state.media[f.versionId]?.imageHash) continue;
        if (Date.now() > deadline - 8_000) { await commit(); return "advanced"; }
        if (f.type === "video") {
          let videoId: string;
          try {
            const r = await metaApi<{ id: string }>(`/${await getAdAccountId()}/advideos`, { method: "POST", body: { file_url: f.url, title: f.name } });
            videoId = r.id;
          } catch (e) {
            if (isPermanent(e)) throw e;
            // Meta could not pull the file: push the bytes instead
            const res = await fetch(f.url);
            if (!res.ok) throw new Error(`Download failed for ${f.name}`);
            const { uploadVideo } = await import("@/lib/meta/creatives");
            videoId = (await uploadVideo(Buffer.from(await res.arrayBuffer()), f.name)).id;
          }
          state.media[f.versionId] = { videoId, startedAt: new Date().toISOString() };
          pushLog(state, `Video sent to Meta: ${f.hookLabel ?? f.name} → ${videoId}`);
        } else {
          const res = await fetch(f.url);
          if (!res.ok) throw new Error(`Download failed for ${f.name}`);
          const r = await uploadImage(Buffer.from(await res.arrayBuffer()), f.name);
          const hash = Object.values(r.images)[0]?.hash;
          if (!hash) throw new Error(`Meta returned no image hash for ${f.name}`);
          state.media[f.versionId] = { imageHash: hash, ready: true };
          pushLog(state, `Image uploaded: ${f.hookLabel ?? f.name}`);
        }
        await commit();
      }
      // readiness: one status check per video per run, never a long wait
      let pending = 0;
      for (const f of state.files ?? []) {
        const m = state.media[f.versionId];
        if (!m || m.ready) continue;
        const r = await metaApi<{ status?: { video_status?: string } }>(`/${m.videoId}`, { params: { fields: "status" } });
        const st = r.status?.video_status;
        if (st === "ready") {
          m.ready = true; m.thumbnailUrl = (await getVideoThumbnail(m.videoId!)) ?? undefined;
          pushLog(state, `Video ready: ${f.hookLabel ?? f.name}`);
        } else if (st === "error") {
          throw new Error(`Meta could not process ${f.name} (video_status=error)`);
        } else {
          const started = m.startedAt ? Date.parse(m.startedAt) : Date.now();
          if (Date.now() - started > 30 * 60 * 1000) { m.ready = true; pushLog(state, `Proceeding with ${f.name} after 30 min of processing`); }
          else pending++;
        }
      }
      await commit(pending === 0 ? "ads" : undefined);
      if (pending > 0) { await save(job, { nextRunAt: new Date(Date.now() + 10_000) }); return "waiting"; }
      return "advanced";
    }

    case "ads": {
      state.ads ??= {};
      const lps = state.landingPages ?? [];
      const copy = state.copy!;
      let existing: Awaited<ReturnType<typeof getAds>> | null = null;
      for (const f of state.files ?? []) {
        for (let i = 0; i < lps.length; i++) {
          const key = `${f.versionId}|${i}`;
          if (state.ads[key]) continue;
          if (Date.now() > deadline - 8_000) { await commit(); return "advanced"; }
          const adName = adNameFor(f.name, i, lps.length);
          existing ??= await getAds(state.adsetId!, 500);
          const dup = existing.find((a) => a.name === adName);
          if (dup) { state.ads[key] = { adId: dup.id, creativeId: dup.creative?.id ?? "", adName, landingPage: lps[i] }; pushLog(state, `Ad reused: ${adName}`); await commit(); continue; }

          let creative: { id: string };
          if (cfg.sourcePostId) {
            creative = await createAdCreative({ name: adName, object_story_id: cfg.sourcePostId });
          } else {
            const m = state.media?.[f.versionId];
            if (!m) throw new Error(`No media for ${f.name}`);
            const payload: Record<string, unknown> = { name: adName, object_story_spec: { page_id: state.pageId } };
            if (m.videoId) {
              const vd: Record<string, unknown> = { video_id: m.videoId, message: copy.primaryTexts[0] || "", title: copy.headlines[0] || "", call_to_action: { type: copy.ctaType, value: { link: lps[i] } } };
              if (m.thumbnailUrl) vd.image_url = m.thumbnailUrl;
              (payload.object_story_spec as Record<string, unknown>).video_data = vd;
            } else {
              (payload.object_story_spec as Record<string, unknown>).link_data = { link: lps[i], message: copy.primaryTexts[0] || "", name: copy.headlines[0] || "", description: copy.descriptions[0] || "", image_hash: m.imageHash, call_to_action: { type: copy.ctaType } };
            }
            if (copy.headlines.length > 1 || copy.primaryTexts.length > 1) {
              payload.asset_feed_spec = {
                ...(copy.headlines.length ? { titles: copy.headlines.map((t) => ({ text: t })) } : {}),
                ...(copy.primaryTexts.length ? { bodies: copy.primaryTexts.map((t) => ({ text: t })) } : {}),
                ...(copy.descriptions.length ? { descriptions: copy.descriptions.map((t) => ({ text: t })) } : {}),
                optimization_type: "DEGREES_OF_FREEDOM",
              };
            }
            creative = await createAdCreative(payload as Parameters<typeof createAdCreative>[0]);
          }
          const ad = await createAd({ adset_id: state.adsetId!, name: adName, creative: { creative_id: creative.id }, status: "PAUSED" });
          state.ads[key] = { adId: ad.id, creativeId: creative.id, adName, landingPage: lps[i] };
          pushLog(state, `Ad created: ${adName}`);
          await commit();
        }
      }
      await commit("finalize");
      return "advanced";
    }

    case "finalize": {
      const ads = Object.values(state.ads ?? {});
      if (!state.postId && !cfg.sourcePostId && ads[0]) state.postId = await getAdPostId(ads[0].adId);
      if (cfg.sourcePostId) state.postId = cfg.sourcePostId;
      const [assignment] = await db.select().from(schema.assignments).where(eq(schema.assignments.id, job.assignmentId));
      if (!assignment) throw new Error("Assignment not found");
      await db.update(schema.assignments).set({
        metaAdId: ads[0]?.adId ?? null, metaAdsetId: state.adsetId, metaCampaignId: state.campaignId, metaPostId: state.postId ?? null,
        status: "posted", completedAt: new Date(), updatedAt: new Date(),
      }).where(eq(schema.assignments.id, job.assignmentId));

      const [editor] = assignment.assignedToId ? await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, assignment.assignedToId)) : [];
      const files = await listDeliverableFiles(job.assignmentId);
      for (const f of files) {
        const m = state.media?.[f.id];
        const firstAd = ads.find((a) => a.adName.startsWith(f.filename.replace(/\.[^.]+$/, "").replace(/^\d{10,}-/, "")));
        if (!m && !firstAd) continue;
        if (f.creativeId) continue; // already in the library from an earlier run
        const [lib] = await db.insert(schema.creatives).values({
          name: f.filename, type: isImage(f.filename) ? "image" : "video", source: "r2", r2Key: f.r2Key, r2Url: f.r2Url, thumbnailUrl: f.thumbnailUrl,
          fileSize: f.fileSize, width: f.width, height: f.height, duration: f.duration,
          metaVideoId: m?.videoId ?? null, metaImageHash: m?.imageHash ?? null, assignmentId: job.assignmentId,
          editorName: editor?.name ?? null, batchNumber: assignment.batchNumber != null ? String(assignment.batchNumber) : null, status: "uploaded",
        }).returning({ id: schema.creatives.id });
        await db.update(schema.deliverableVersions).set({ metaVideoId: m?.videoId ?? null, metaImageHash: m?.imageHash ?? null, metaAdId: firstAd?.adId ?? null, creativeId: lib?.id ?? null }).where(eq(schema.deliverableVersions.id, f.id));
      }

      // remember for the next brief of this product + country
      try {
        const patch = { campaignId: state.campaignId ?? null, campaignName: state.campaignName ?? null, templateId: cfg.templateId ?? null, dailyBudget: cfg.dailyBudget != null ? cfg.dailyBudget / 100 : null, landingPage: state.landingPages?.[0] ?? null, updatedAt: new Date() };
        const [d] = await db.select({ id: schema.publishDefaults.id }).from(schema.publishDefaults).where(and(
          assignment.productId ? eq(schema.publishDefaults.productId, assignment.productId) : isNull(schema.publishDefaults.productId),
          assignment.countryId ? eq(schema.publishDefaults.countryId, assignment.countryId) : isNull(schema.publishDefaults.countryId),
        ));
        if (d) await db.update(schema.publishDefaults).set(patch).where(eq(schema.publishDefaults.id, d.id));
        else await db.insert(schema.publishDefaults).values({ productId: assignment.productId, countryId: assignment.countryId, ...patch });
      } catch (e) { pushLog(state, `publish_defaults skipped: ${e instanceof Error ? e.message : e}`); }

      // Learning Loop: the new ad set IS this brief
      try {
        await db.insert(schema.adsetsCache).values({ id: state.adsetId!, adAccountId: await getAdAccountId(), campaignId: state.campaignId!, name: state.adsetName!, status: "PAUSED", effectiveStatus: "PAUSED", createdTime: new Date() }).onConflictDoNothing();
        await applyLinks([{ assignmentId: job.assignmentId, adsetId: state.adsetId! }], "publish", job.createdById);
      } catch (e) { pushLog(state, `Learning Loop link skipped: ${e instanceof Error ? e.message : e}`); }

      state.finalized = true;
      pushLog(state, `Done: ${ads.length} ads in ${state.adsetName} (paused)`);
      await commit("done");
      return "done";
    }

    default:
      return "done";
  }
}
