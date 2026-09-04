// Import a brief.json (see brain/HANDOFF_METAADSUPLOAD.md) as assignments:
// one per ad-set, with the copy as a template, the files as H1/H2/… under
// Files, and campaign/budget/landers remembered for the Upload-to-Meta dialog.
//
//   node --env-file=.env.local --import tsx scripts/import-brief.mts brief.json [--dry-run] [--assignee Gene] [--by <admin email>]
import { readFile, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { and, eq, ilike, isNull } from "drizzle-orm";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import bcrypt from "bcryptjs";
import { db, schema } from "../src/db";
import { addDeliverableFile } from "../src/lib/deliverables";
import { getR2Bucket, getR2Client, getR2PublicUrl } from "../src/lib/r2";

interface LandingPage { label: string; path: string; cta?: string }
interface BriefFile { hook: string; caption?: string; path: string }
interface BriefAdset {
  index: number; title: string; adsetName?: string; productLabel?: string; productCode?: string;
  avatar?: string | null; awarenessLevel?: string | null; reference?: string | null; confidence?: string | null;
  hypothesis?: string; variableTested?: string; adType?: string; problem?: string;
  campaign?: { name: string; id: string } | null; dailyBudget?: number | null; budgetText?: string | null;
  page?: string | null; attribution?: string | null; landingPages: LandingPage[];
  copy: { primaryTexts: string[]; headlines: string[]; descriptions: string[] };
  files: BriefFile[]; complianceNotes?: string[]; risk?: string; brief?: string;
}
interface Brief { source?: string; title: string; batchLabel: string; batchNumber: number; editor: string; strategist?: string; country: string; format: string; storeDomain?: string; adsets: BriefAdset[] }

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) { console.error("usage: import-brief.mts brief.json [--dry-run] [--assignee Name] [--by admin@email]"); process.exit(1); }
const DRY = args.includes("--dry-run");
const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const brief: Brief = JSON.parse(await readFile(file, "utf8"));
const STORE = (brief.storeDomain ?? "https://apotekhunden.se").replace(/\/$/, "");
const assigneeName = opt("--assignee") ?? brief.editor ?? "Gene";

const PRODUCT_CODES: Array<[RegExp, string, string]> = [
  [/munh[äa]lsa.*katt|katt.*munh[äa]lsa|kattmunh/i, "MUNK", "Munhälsa Katt"],
  [/munh[äa]lsa|oralhealth/i, "MUN", "Munhälsa"],
  [/probiotik/i, "PRO", "Probiotika"],
  [/allergi|kl[åa]da|skin|coat/i, "SC", "Skin & Coat"],
  [/calming|lugn/i, "CLM", "Calming"],
  [/led/i, "LT", "Ledtillskott"],
];
const fullUrl = (p: string) => (/^https?:\/\//.test(p) ? p : `${STORE}${p.startsWith("/") ? "" : "/"}${p}`);
const log = (s: string) => console.log(s);

// ── lookups (create when missing) ──────────────────────────────────────────
async function findOrCreateUser(name: string, role: "admin" | "editor", userType: string) {
  const [u] = await db.select().from(schema.users).where(ilike(schema.users.name, name));
  if (u) return u;
  if (DRY) { log(`  would create user "${name}" (${role})`); return { id: `dry-${name}`, name } as typeof schema.users.$inferSelect; }
  const [created] = await db.insert(schema.users).values({
    name, role, userType, email: `${name.toLowerCase().replace(/\s+/g, ".")}@apotekhunden.se`,
    password: await bcrypt.hash(crypto.randomUUID() + crypto.randomUUID(), 10), slug: name.toLowerCase().replace(/\s+/g, "-"), isActive: true,
  }).returning();
  log(`  created user "${name}" (${role}, no login password set)`);
  return created;
}
async function productFor(a: BriefAdset) {
  const label = a.productCode ?? a.productLabel ?? a.adsetName ?? "";
  const hit = a.productCode ? PRODUCT_CODES.find(([, code]) => code === a.productCode) : PRODUCT_CODES.find(([re]) => re.test(label));
  if (!hit) return null;
  const [, code, name] = hit;
  const [p] = await db.select().from(schema.products).where(eq(schema.products.code, code));
  if (p) return p;
  if (DRY) { log(`  would create product ${name} (${code})`); return { id: `dry-${code}`, name, code } as typeof schema.products.$inferSelect; }
  const [created] = await db.insert(schema.products).values({ name, code }).returning();
  log(`  created product ${name} (${code})`);
  return created;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function byName<T extends { id: string; name: string }>(table: any, name: string | null | undefined, create: () => Record<string, unknown>, what: string): Promise<T | null> {
  if (!name) return null;
  const rows = (await db.select().from(table).where(ilike(table.name, name))) as unknown as T[];
  if (rows[0]) return rows[0];
  if (DRY) { log(`  would create ${what} "${name}"`); return { id: `dry-${what}-${name}`, name } as T; }
  const created = (await db.insert(table).values(create()).returning()) as unknown as T[];
  log(`  created ${what} "${name}"`);
  return created[0];
}
// Gene's ad set names: "SE Gene Sep1 - Statics #1 - 8TECKEN - PROBIOTIKA - 399 - MIX"
// → the concept (8TECKEN) is the creative angle; the last token is only a
// problem when it already exists in the app's problem taxonomy.
const PRODUCT_PROBLEM: Record<string, string | null> = { PRO: "Mix", MUN: "OralHealth", MUNK: "OralHealth", SC: "ItchySkin", CLM: null, LT: null };
const conceptOf = (adsetName: string) => { const parts = adsetName.split(" - ").map((x) => x.trim()); return parts.length >= 3 ? parts[2] : null; };
const AVATAR_NOISE = new Set(["kärnavataren", "spår", "core"]);
const avatarNames = (raw: string | null | undefined) => (raw ?? "").split("(")[0].split(/\s*[\/+·]\s*/).map((x) => x.trim().replace(/[^\wåäöÅÄÖ-]+.*$/u, "")).filter((x) => /^[\wåäöÅÄÖ-]{3,}$/u.test(x) && !/^Q\d/.test(x) && !AVATAR_NOISE.has(x.toLowerCase()));

// ── main ───────────────────────────────────────────────────────────────────
log(`${DRY ? "[dry-run] " : ""}${brief.title} — ${brief.adsets.length} ad-sets, batch ${brief.batchLabel} (#${brief.batchNumber})`);
const byEmail = opt("--by");
const [admin] = byEmail
  ? await db.select().from(schema.users).where(eq(schema.users.email, byEmail))
  : await db.select().from(schema.users).where(and(eq(schema.users.role, "admin"), eq(schema.users.isActive, true)));
if (!admin) throw new Error("no admin user to assign by");
const assignee = await findOrCreateUser(assigneeName, "editor", "creative_strategist");
const strategist = brief.strategist && brief.strategist !== assigneeName ? await findOrCreateUser(brief.strategist, "editor", "creative_strategist") : assignee;
const [country] = await db.select().from(schema.countries).where(eq(schema.countries.code, brief.country || "SE"));
const [format] = await db.select().from(schema.formats).where(ilike(schema.formats.name, brief.format || "Image Ad"));
if (!country || !format) throw new Error(`country ${brief.country} or format ${brief.format} not found`);

const r2 = DRY ? null : getR2Client();
let created = 0, skipped = 0;
for (const a of brief.adsets) {
  const adsetName = a.adsetName ?? `${brief.country} ${assigneeName} ${brief.batchLabel} - #${a.index} - ${a.title}`;
  log(`\n#${a.index} ${adsetName}`);
  const [existing] = await db.select({ id: schema.assignments.id }).from(schema.assignments).where(eq(schema.assignments.autoName, adsetName));
  if (existing) { log("  exists — skipped"); skipped++; continue; }

  const product = await productFor(a);
  const lastToken = adsetName.split(" - ").pop()?.trim() ?? "";
  const existingProblems = (await db.select().from(schema.problems)) as Array<{ id: string; name: string }>;
  const problemName = a.problem ?? existingProblems.find((p) => p.name.toLowerCase() === lastToken.toLowerCase())?.name ?? (product ? PRODUCT_PROBLEM[product.code] ?? null : null);
  const problem = await byName<{ id: string; name: string }>(schema.problems, problemName, () => ({ name: problemName }), "problem");
  const angleName = conceptOf(adsetName);
  const angle = await byName<{ id: string; name: string }>(schema.angles, angleName, () => ({ name: angleName }), "angle");
  const avatars: Array<{ id: string; name: string }> = [];
  for (const n of avatarNames(a.avatar)) {
    const av = await byName<{ id: string; name: string }>(schema.customerAvatars, n, () => ({ name: n, code: n.toUpperCase().replace(/[^A-Z0-9ÅÄÖ]+/g, "_").slice(0, 24) }), "avatar");
    if (av) avatars.push(av);
  }
  const lps = a.landingPages.map((l) => ({ ...l, url: fullUrl(l.path) }));
  const ctaType = lps[0]?.cta ?? "SHOP_NOW";

  const briefMd = a.brief ?? [
    `# ${a.title}`,
    ``,
    `**Ad-set:** ${adsetName}  `,
    a.reference ? `**Referens:** ${a.reference}  ` : "",
    a.avatar ? `**Avatar:** ${a.avatar}  ` : "",
    a.confidence ? `**Konfidens:** ${a.confidence}  ` : "",
    a.risk ? `**Meta-risk:** ${a.risk}  ` : "",
    ``,
    `## Hypotes`, a.hypothesis ?? "", ``,
    ...a.copy.primaryTexts.map((t, i) => `## Primärtext ${i + 1}\n${t}\n`),
    `## Rubriker`, ...a.copy.headlines.map((h) => `- ${h}`), ``,
    `## Beskrivning`, ...a.copy.descriptions.map((d) => `- ${d}`), ``,
    `## Launch`,
    a.campaign ? `- Kampanj: ${a.campaign.name} · ${a.campaign.id}` : "",
    a.budgetText ? `- Budget: ${a.budgetText}` : a.dailyBudget ? `- Budget: ${a.dailyBudget} kr/dag` : "",
    a.page ? `- Sida: ${a.page}` : "", a.attribution ? `- Attribution: ${a.attribution}` : "",
    ...lps.map((l) => `- ${l.label}: ${l.url} · ${l.cta ?? "SHOP_NOW"}`), ``,
    a.files.length ? `## Filer\n${a.files.map((f) => `- ${f.hook}: ${f.caption ?? basename(f.path)}`).join("\n")}\n` : "",
    a.complianceNotes?.length ? `## Compliance\n${a.complianceNotes.map((n) => `- ${n}`).join("\n")}\n` : "",
    brief.source ? `Källa: ${brief.source}` : "",
  ].filter((l) => l !== null).join("\n");

  if (DRY) {
    log(`  product=${product?.name ?? "?"} angle=${angle?.name} problem=${problem?.name} avatars=${avatars.map((v) => v.name).join(",")} lps=${lps.map((l) => l.label).join("+")} campaign=${a.campaign?.name ?? "-"} budget=${a.dailyBudget} files=${a.files.length} pt=${a.copy.primaryTexts.length} hl=${a.copy.headlines.length}`);
    continue;
  }

  const [template] = await db.insert(schema.templates).values({
    name: `${brief.batchLabel} #${a.index} · ${a.title.slice(0, 60)}`,
    objective: "OUTCOME_SALES", budgetType: "ABO", dailyBudget: a.dailyBudget ?? null, currency: "SEK",
    headlines: a.copy.headlines, primaryTexts: a.copy.primaryTexts, descriptions: a.copy.descriptions,
    ctaType, landingPages: lps.map((l) => l.url), productName: product?.name ?? null,
  }).returning();

  const [assignment] = await db.insert(schema.assignments).values({
    title: a.title, batchNumber: brief.batchNumber, version: 1,
    formatId: format.id, productId: product?.id ?? null, countryId: country.id, problemId: problem?.id ?? null, angleId: angle?.id ?? null,
    customerAvatarIds: avatars.map((v) => v.id),
    landingPage: lps[0]?.url ?? null,
    assignedToId: assignee.id, assignedById: admin.id,
    creativeStrategistId: strategist.id, creativeStrategistName: strategist.name,
    priority: "medium",
    status: a.files.length ? "ready_for_review" : "ready_for_editing",
    autoName: adsetName,
    description: [a.reference ? `Referens: ${a.reference}` : null, a.avatar ? `Avatar: ${a.avatar}` : null, a.confidence ? `Konfidens: ${a.confidence}` : null, a.risk ? `Meta-risk: ${a.risk}` : null].filter(Boolean).join("\n"),
    briefContent: briefMd,
    references: brief.source ? [{ id: crypto.randomUUID(), kind: "url" as const, value: brief.source, label: "Artefakt" }] : [],
    scriptContent: { hooks: a.files.map((f) => ({ id: f.hook, label: f.hook, eng: "", se: f.caption ?? "" })), body: { eng: "", se: a.copy.primaryTexts[0] ?? "" } },
    hypothesis: a.hypothesis ?? null, variableTested: a.variableTested ?? (a.reference ? `Layout/referens: ${a.reference}` : null),
    adType: a.adType ?? "ideation", awarenessLevel: a.awarenessLevel ?? null,
    publishTemplateId: template.id,
    startedAt: new Date(),
  }).returning();

  for (const f of a.files) {
    const abs = resolve(f.path);
    const size = (await stat(abs)).size;
    const ext = extname(abs).toLowerCase();
    const contentType = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : ext === ".mp4" ? "video/mp4" : ext === ".mov" ? "video/quicktime" : "image/jpeg";
    const original = basename(abs);
    const key = `deliverables/${assignee.name.replace(/[^a-zA-Z0-9._-]/g, "_")}/Batch_${brief.batchNumber}/${Date.now()}-${original.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    await r2!.send(new PutObjectCommand({ Bucket: getR2Bucket(), Key: key, Body: await readFile(abs), ContentType: contentType }));
    await addDeliverableFile(assignment, assignee.id, { r2Key: key, r2Url: `${getR2PublicUrl()}/${key}`, filename: original, contentType, fileSize: size, hookLabel: f.hook });
  }

  if (product && a.campaign) {
    const [d] = await db.select({ id: schema.publishDefaults.id }).from(schema.publishDefaults).where(and(eq(schema.publishDefaults.productId, product.id), eq(schema.publishDefaults.countryId, country.id)));
    const patch = { campaignId: a.campaign.id, campaignName: a.campaign.name, templateId: template.id, dailyBudget: a.dailyBudget ?? null, landingPage: lps[0]?.url ?? null, updatedAt: new Date() };
    if (d) await db.update(schema.publishDefaults).set(patch).where(eq(schema.publishDefaults.id, d.id));
    else await db.insert(schema.publishDefaults).values({ productId: product.id, countryId: country.id, ...patch });
  }
  log(`  ✓ assignment ${assignment.id} · template #${template.id} · ${a.files.length} files · ${assignment.status}`);
  created++;
}
log(`\ndone: ${created} created, ${skipped} skipped${DRY ? " (dry-run, nothing written)" : ""}`);
void isNull;
