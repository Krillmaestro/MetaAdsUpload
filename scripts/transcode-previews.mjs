// Make browser-playable previews of the library masters.
//
// The editors' masters in R2 are 50–600 MB .mov/.mp4 files with the MP4 index
// at the END, so a browser has to download the whole file before it can show
// frame one. This job downloads each master once, transcodes it to a small
// 720p H.264/AAC mp4 with the index up front, uploads it to R2 under
// previews/, and stores the url on the creative. The Learning Loop plays that.
//
// Runs nightly in GitHub Actions (ffmpeg is on the runner) and can be run
// locally: node --env-file=.env.local scripts/transcode-previews.mjs
//
// Env: DATABASE_URL, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
//      R2_BUCKET_NAME, R2_PUBLIC_URL, optional LIMIT (default 40).

import { neon } from "@neondatabase/serverless";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const env = (k) => (process.env[k] ?? "").trim();
const sql = neon(env("DATABASE_URL"));
const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${env("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: env("R2_ACCESS_KEY_ID"), secretAccessKey: env("R2_SECRET_ACCESS_KEY") },
});
const BUCKET = env("R2_BUCKET_NAME");
const PUBLIC = env("R2_PUBLIC_URL").replace(/\/$/, "");
const LIMIT = parseInt(env("LIMIT") || "40", 10) || 40;
// Parallel backfill: SHARDS jobs run at once, each taking the masters whose
// object url hashes to its SHARD. Sharding on the url keeps duplicate rows of
// one object in the same job so they are transcoded once.
// Only masters behind ads that have spent at least this much (SEK, lifetime)
// get a preview — nobody opens the learning dialog for a 300 kr test.
const MIN_SPEND = parseFloat(env("MIN_SPEND") || "2000") || 2000;
const SHARDS = Math.max(1, parseInt(env("SHARDS") || "1", 10) || 1);
const SHARD = parseInt(env("SHARD") || "0", 10) || 0;
const shardOf = (str) => { let h = 0; for (const ch of str) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h % SHARDS; };

// Same loose identity as src/lib/learning-loop/derive.ts (kept in sync by hand:
// this script runs without the TypeScript build).
function looseKey(name) {
  if (!name) return null;
  const t = name.replace(/^\d{10,}-/, "").replace(/\.(mp4|mov|webm|jpg|jpeg|png|webp)$/i, "").replace(/_/g, " ").replace(/\s+/g, " ").trim();
  const hook = t.match(/^(H\d+)\b/i)?.[1]?.toUpperCase() ?? "";
  const batch = t.match(/\b(jan|feb|mar|apr|maj|may|jun|jul|aug|sep|okt|oct|nov|dec)\d+(?:\.\d+)?(?:\.?v\d+)?/i)?.[0]?.toLowerCase() ?? "";
  if (!batch) return null;
  const editor = t.match(/\b(SE|USA|US|UK|AU)\s+([A-Za-zÅÄÖåäö]+)/)?.[2]?.toLowerCase() ?? t.split(" ")[1]?.toLowerCase() ?? "";
  const fmt = t.match(/\b(VSL|UGC|STATIC|ANIME|Non narrated|NON_NARRATED)\b/i)?.[1]?.toLowerCase().replace("_", " ") ?? "";
  return `${hook}|${editor}|${batch}|${fmt}`;
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => { err += d.toString(); if (err.length > 4000) err = err.slice(-4000); });
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}: ${err.slice(-600)}`))));
  });
}

async function candidates() {
  const lib = await sql.query(`select id, name, r2_url, meta_video_id from creatives where type='video' and r2_url is not null and preview_url is null and preview_error is null`);
  // Lifetime spend per ad, converted to SEK (DogDivaCO bills in USD).
  const [conn] = await sql.query(`select ad_accounts from meta_connections limit 1`);
  const [fx] = await sql.query(`select sek_per_usd from evolve_settings limit 1`);
  const sekPerUsd = Number(fx?.sek_per_usd) || 10.5;
  const currencyOf = new Map((conn?.ad_accounts ?? []).map((a) => [String(a.id).replace(/^act_/, ""), a.currency]));
  const toSek = (spend, accountId) => Number(spend) * (currencyOf.get(String(accountId ?? "").replace(/^act_/, "")) === "USD" ? sekPerUsd : 1);
  const ads = await sql.query(`select a.name, a.video_id, a.ad_account_id, sum(i.spend) as spend from insights i join ads_cache a on a.id=i.entity_id where i.entity_type='ad' and i.spend>0 and a.video_id is not null group by a.name, a.video_id, a.ad_account_id`);
  const spendByKey = new Map(); const spendByVideo = new Map();
  for (const a of ads) { const sek = toSek(a.spend, a.ad_account_id); const k = looseKey(a.name); if (k) spendByKey.set(k, (spendByKey.get(k) ?? 0) + sek); spendByVideo.set(a.video_id, (spendByVideo.get(a.video_id) ?? 0) + sek); }
  // Re-uploads leave several rows pointing at the same object: transcode each
  // object once and copy the result to its siblings (see one()).
  const seenUrl = new Set();
  return lib
    .map((c) => ({ ...c, spend: (c.meta_video_id ? spendByVideo.get(c.meta_video_id) : 0) || spendByKey.get(looseKey(c.name)) || 0 }))
    .filter((c) => c.spend >= MIN_SPEND)
    .sort((a, b) => b.spend - a.spend || b.id - a.id)
    .filter((c) => shardOf(c.r2_url) === SHARD)
    .filter((c) => !seenUrl.has(c.r2_url) && seenUrl.add(c.r2_url))
    .slice(0, LIMIT);
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`download ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

async function one(c, dir) {
  const ext = (c.r2_url.match(/\.(\w+)(\?|$)/)?.[1] ?? "mp4").toLowerCase();
  const src = join(dir, `${c.id}.${ext}`);
  const out = join(dir, `${c.id}.preview.mp4`);
  const t0 = Date.now();
  await download(c.r2_url, src);
  const size = (await stat(src)).size;
  await run("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error", "-i", src,
    "-vf", "scale=-2:'min(720,ih)'", "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "96k", "-ac", "2", "-movflags", "+faststart", out,
  ]);
  const body = await readFile(out);
  const key = `previews/${c.id}.mp4`;
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: "video/mp4", CacheControl: "public, max-age=31536000, immutable" }));
  const url = `${PUBLIC}/${key}`;
  await sql.query(`update creatives set preview_url=$1, preview_at=now(), preview_error=null where id=$2 or (r2_url=$3 and preview_url is null)`, [url, c.id, c.r2_url]);
  await rm(src, { force: true }); await rm(out, { force: true });
  console.log(`ok   #${c.id} ${(size / 1e6).toFixed(0)}MB → ${(body.length / 1e6).toFixed(1)}MB in ${((Date.now() - t0) / 1000).toFixed(0)}s  ${c.name.slice(0, 60)}`);
}

const dir = await mkdtemp(join(tmpdir(), "previews-"));
const list = await candidates();
console.log(`${list.length} masters to preview (spend ≥ ${MIN_SPEND} kr, limit ${LIMIT}, shard ${SHARD + 1}/${SHARDS})`);
let ok = 0, failed = 0;
for (const c of list) {
  try { await one(c, dir); ok++; }
  catch (e) {
    failed++;
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    console.log(`FAIL #${c.id} ${c.name.slice(0, 60)}: ${msg}`);
    // A missing ffmpeg (or similar) is the environment's fault, not the file's:
    // stop here so the rows stay eligible for the next run.
    if (/ENOENT|EACCES/.test(msg)) { await rm(dir, { recursive: true, force: true }); console.error("environment error, aborting run"); process.exit(1); }
    await sql.query(`update creatives set preview_error=$1, preview_at=now() where id=$2`, [msg, c.id]).catch(() => {});
  }
}
await rm(dir, { recursive: true, force: true });
console.log(`done: ${ok} ok, ${failed} failed`);
