// Kör lagersynken från terminalen (samma logik som /api/lager/sync).
// Usage: node scripts/lager-sync-cli.mjs [dagar]
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const sql = neon((process.env.DATABASE_URL||"").replace(/\\[rn]/g,"").trim());
const DAYS = Number(process.argv[2] || 60);

const CATALOG = [
  ["PRO","3-i-1 Probiotika",["1","1D","1E"],["probiotika"],"burkar",10],
  ["KLA","Quercetin+ (Klåda & Allergi)",["5"],["klåda & allergi","quercetin+","hud+ tuggor"],"burkar",20],
  ["MUN","MUNHÄLSA+ hund",["2"],["munhälsa"],"burkar",30],
  ["CLM","Calming Chews",["7"],["calming chews","daglig+ tuggor"],"burkar",40],
  ["SC","Skin & Coat",["6"],["skin & coat"],"burkar",50],
  ["LT","Ledtillskott",["4"],["ledtillskott"],"burkar",60],
  ["BEL","Belöningsbitar+ Kalkon (gåva)",["8","8B"],["belöningsbitar"],"påsar",70],
  ["FB","FingerBorste (gåva)",["9-1","9-3","9-4"],["fingerborste"],"st",80],
  ["TSK","Tandstensskrapa (gåva)",["10"],["tandstensskrapa"],"st",90],
];
const IGNORE = ["svenska guiden","leverans skydd","e-bok","tandvårdsguiden"];

let products = await sql`SELECT id, code, name, match_skus, match_titles FROM inventory_products`;
if (products.length === 0) {
  for (const [code,name,skus,titles,unit,sort] of CATALOG) {
    await sql`INSERT INTO inventory_products (id,name,code,match_skus,match_titles,unit_label,sort_order)
      VALUES (${randomUUID()},${name},${code},${JSON.stringify(skus)}::jsonb,${JSON.stringify(titles)}::jsonb,${unit},${sort})`;
  }
  products = await sql`SELECT id, code, name, match_skus, match_titles FROM inventory_products`;
  console.log('katalog skapad:', products.length, 'produkter');
}
const P = products.map(p => ({id:p.id, code:p.code, skus:p.match_skus||[], titles:(p.match_titles||[]).map(t=>t.toLowerCase())}));
function match(title, sku) {
  const t = (title||'').toLowerCase().trim();
  if (!t || IGNORE.some(x=>t.includes(x))) return null;
  const s = (sku||'').trim();
  if (s) { const bySku = P.filter(p=>p.skus.includes(s));
    if (bySku.length===1) { const p=bySku[0];
      const fits = p.titles.some(x=>t.includes(x));
      const other = P.some(o=>o.id!==p.id && o.titles.some(x=>t.includes(x)));
      if (fits || !other) return p.id; } }
  for (const p of P) if (p.titles.some(x=>t.includes(x))) return p.id;
  return null;
}
const store = process.env.SHOPIFY_STORE;
const tr = await fetch(`https://${store}/admin/oauth/access_token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:process.env.SHOPIFY_CLIENT_ID,client_secret:process.env.SHOPIFY_CLIENT_SECRET})});
const T=(await tr.json()).access_token;
const since=new Date(Date.now()-DAYS*864e5).toISOString();
let url=`https://${store}/admin/api/2024-01/orders.json?status=any&limit=250&created_at_min=${encodeURIComponent(since)}&fields=id,created_at,cancelled_at,line_items`;
const per=new Map(), un=new Map(); let orders=0, page=0;
while(url && page<60){ const res=await fetch(url,{headers:{'X-Shopify-Access-Token':T}});
  if(res.status===429){ await new Promise(r=>setTimeout(r,2000)); continue; }
  const j=await res.json();
  for(const o of j.orders||[]){ if(o.cancelled_at) continue; orders++;
    const day=o.created_at.slice(0,10);
    for(const l of o.line_items||[]){ const pid=match(l.title,l.sku);
      if(!pid){ const t=(l.title||'?').slice(0,50); if(!IGNORE.some(x=>t.toLowerCase().includes(x))) un.set(t,(un.get(t)||0)+l.quantity); continue; }
      const k=`${pid}|${day}`; const slot=per.get(k)||{u:0,o:new Set()}; slot.u+=l.quantity; slot.o.add(o.id); per.set(k,slot); } }
  const link=res.headers.get('link'); const m=link&&link.match(/<([^>]+)>;\s*rel="next"/); url=m?m[1]:null; page++; }
let rows=0;
for(const [k,v] of per){ const [pid,day]=k.split('|');
  await sql`INSERT INTO inventory_sales_daily (product_id, sold_on, units, orders) VALUES (${pid},${day},${v.u},${v.o.size})
    ON CONFLICT (product_id, sold_on) DO UPDATE SET units=EXCLUDED.units, orders=EXCLUDED.orders, synced_at=now()`; rows++; }
console.log(`synkat ${orders} ordrar → ${rows} produktdagar`);
if(un.size) console.log('omatchat:', [...un.entries()].sort((a,b)=>b[1]-a[1]).slice(0,6).map(([t,q])=>`${t} (${q})`).join(' | '));
const sum = await sql`SELECT p.code, p.name, sum(s.units)::int total,
    round(sum(s.units) FILTER (WHERE s.sold_on >= current_date - 30)::numeric/30,1) per_dag_30,
    round(sum(s.units) FILTER (WHERE s.sold_on >= current_date - 7)::numeric/7,1) per_dag_7
  FROM inventory_products p JOIN inventory_sales_daily s ON s.product_id=p.id GROUP BY p.code,p.name,p.sort_order ORDER BY p.sort_order`;
console.log('\nkod  produkt                           60d      /dag30  /dag7');
for(const r of sum) console.log(`${r.code.padEnd(4)} ${r.name.slice(0,32).padEnd(33)} ${String(r.total).padStart(6)}  ${String(r.per_dag_30).padStart(6)}  ${String(r.per_dag_7).padStart(5)}`);
