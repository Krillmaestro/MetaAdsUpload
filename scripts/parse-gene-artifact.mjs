// Turn a Gene statics artifact (the "Statics <date> · <brand>" layout with one
// <section class="set"> per ad-set) into brief.json + image files, ready for
// scripts/import-brief.mts. Usage:
//   node scripts/parse-gene-artifact.mjs <artifact.html> <outdir> [--batch Sep1] [--number 901]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const [src, out, ...rest] = process.argv.slice(2);
if (!src || !out) { console.error("usage: parse-gene-artifact.mjs <artifact.html> <outdir> [--batch Sep1] [--number 901] [--source url]"); process.exit(1); }
const opt = (k, d) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : d; };

const html = readFileSync(src, "utf8");
const unescape = (t) => t.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
const clean = (t) => unescape((t ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")).trim();
const kv = (block) => Object.fromEntries([...block.matchAll(/<dt>(.*?)<\/dt>\s*<dd[^>]*>(.*?)<\/dd>/gs)].map((m) => [clean(m[1]), clean(m[2])]));

const title = clean(html.match(/<title>(.*?)<\/title>/s)?.[1] ?? "");
const eyebrowTop = clean(html.match(/<div class="eyebrow">(.*?)<\/div>/s)?.[1] ?? "");
const batchLabel = opt("--batch", (title.match(/Statics\s+(\w+)\s+(\d+)/)?.slice(1).join("") ?? "Batch"));
const batchNumber = parseInt(opt("--number", "0"), 10) || (() => {
  const m = title.match(/(Jan|Feb|Mar|Apr|Maj|May|Jun|Jul|Aug|Sep|Okt|Oct|Nov|Dec)\w*\s+(\d+)/i);
  const months = { jan: 1, feb: 2, mar: 3, apr: 4, maj: 5, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, dec: 12 };
  return m ? months[m[1].slice(0, 3).toLowerCase()] * 100 + parseInt(m[2], 10) : 0;
})();

mkdirSync(join(out, "images"), { recursive: true });
const adsets = [];
for (const m of html.matchAll(/<section class="set"[^>]*>(.*?)<\/section>/gs)) {
  const sec = m[1];
  const eyebrow = clean(sec.match(/<div class="eyebrow">(.*?)<\/div>/s)?.[1]);
  const index = parseInt(eyebrow.match(/Ad-set\s+(\d+)/i)?.[1] ?? String(adsets.length + 1), 10);
  const h2 = clean(sec.match(/<h2>(.*?)<\/h2>/s)?.[1]);
  const meta = Object.fromEntries([...sec.matchAll(/<span>([^<:]+):\s*<b>(.*?)<\/b>/gs)].map((x) => [clean(x[1]), clean(x[2])]));
  const hypothesis = clean(sec.match(/<div class="hyp">(.*?)<\/div>/s)?.[1]).replace(/^Hypotes\.\s*/, "");
  const primaryTexts = [...sec.matchAll(/<h3>Primärtext \d+<\/h3>\s*<div class="pt">(.*?)<\/div>/gs)].map((x) => clean(x[1]));
  const copyKv = kv(sec.match(/<h3>Rubriker[^<]*<\/h3>\s*<dl class="kv">(.*?)<\/dl>/s)?.[1] ?? "");
  const headlines = Object.entries(copyKv).filter(([k]) => /rubrik/i.test(k)).map(([, v]) => v);
  const descriptions = Object.entries(copyKv).filter(([k]) => /beskrivning/i.test(k)).map(([, v]) => v);
  const launch = kv(sec.match(/<h3>Launch<\/h3>\s*<dl class="kv">(.*?)<\/dl>/s)?.[1] ?? "");
  const camp = launch.Kampanj?.match(/(.*?)\s*·\s*(\d+)/);
  const landingPages = Object.entries(launch)
    .filter(([k]) => /^(PP|\d+R|LP\w*)(\s|$)/i.test(k))
    .map(([label, v]) => { const mm = v.match(/(\S+)\s*·\s*([A-Z_]+)/); return { label, path: mm ? mm[1] : v, cta: mm ? mm[2] : "SHOP_NOW" }; });
  const notes = [...(sec.match(/<ul class="notes">(.*?)<\/ul>/s)?.[1] ?? "").matchAll(/<li>(.*?)<\/li>/gs)].map((x) => clean(x[1]));
  const risk = clean(sec.match(/risk">(.*?)<\/span>/s)?.[1]).replace(/^Meta-risk:\s*/i, "");
  const adsetName = launch["Ad-set"] || `SE Gene ${batchLabel} - Statics #${index}`;
  const files = [];
  for (const f of sec.matchAll(/<figure><img src="data:image\/(\w+);base64,([^"]+)"[^>]*>\s*<figcaption><span class="h">(.*?)<\/span><span>(.*?)<\/span><\/figcaption>/gs)) {
    const [, ext, b64, hook, caption] = f;
    const filename = `${clean(hook)} ${adsetName}.${ext === "jpeg" ? "jpg" : ext}`.replace(/[/\\]/g, "-");
    const path = join(out, "images", filename);
    writeFileSync(path, Buffer.from(b64, "base64"));
    files.push({ hook: clean(hook), caption: clean(caption), path });
  }
  const budget = launch.Budget?.match(/(\d[\d\s]*)\s*kr/);
  adsets.push({
    index, title: h2, productLabel: eyebrow.split("·").pop().trim(),
    reference: meta.Referens ?? null, avatar: meta.Avatar ?? null, confidence: meta.Konfidens ?? null,
    awarenessLevel: /omedveten|unaware/i.test(meta.Avatar ?? "") ? "unaware" : /problem/i.test(meta.Avatar ?? "") ? "problem_aware" : null,
    hypothesis, adType: "ideation",
    campaign: camp ? { name: camp[1].trim(), id: camp[2] } : null,
    adsetName, budgetText: launch.Budget ?? null, dailyBudget: budget ? parseInt(budget[1].replace(/\s/g, ""), 10) : null,
    page: launch.Sida ?? null, attribution: launch.Attribution ?? null,
    landingPages, copy: { primaryTexts, headlines, descriptions }, complianceNotes: notes, risk, files,
  });
}
const brief = { source: opt("--source", ""), title, eyebrow: eyebrowTop, batchLabel, batchNumber, editor: "Gene", strategist: "Gene", country: "SE", format: "Image Ad", adsets };
writeFileSync(join(out, "brief.json"), JSON.stringify(brief, null, 1));
console.log(`${adsets.length} ad-sets, ${adsets.reduce((n, a) => n + a.files.length, 0)} files → ${join(out, "brief.json")} (batch ${batchLabel} / ${batchNumber})`);
for (const a of adsets) console.log(`  #${String(a.index).padStart(2)} ${a.productLabel.padEnd(16)} ${a.files.length} img  ${(a.campaign?.name ?? "-").padEnd(22)} ${a.dailyBudget} kr  ${a.landingPages.map((l) => l.label).join("+")}  ${a.adsetName}`);
