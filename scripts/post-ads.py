#!/usr/bin/env python3
"""
post-ads.py — posta creatives till Meta via MetaAdsUpload-appen, direkt från terminalen.

Användning:
  python3 scripts/post-ads.py <mapp-med-creatives> <template-namn> [--campaign SUBSTRÄNG] [--adset SUBSTRÄNG] [--dry-run]

Exempel:
  python3 scripts/post-ads.py ~/Desktop/creatives/juli-batch "DogDiva Evergreen" --campaign "Evergreen"

Flöde (samma som appens UI):
  1. Loggar in mot appen (NextAuth credentials; läser ADMIN_EMAIL/ADMIN_PASSWORD ur .env.local)
  2. Hämtar templaten (copy, CTA, landing page, budget) via /api/templates
  3. Per fil: presign → PUT till R2 → /api/meta/upload-from-r2 (skapar creative + annons, PAUSED)

Annonserna skapas alltid PAUSADE — aktivera i Ads Manager.
"""
import argparse, json, mimetypes, os, sys, urllib.request, urllib.parse, http.cookiejar
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
BASE_URL = os.environ.get("MAU_BASE_URL", "https://meta-ads-upload.vercel.app")
ALLOWED_EXT = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
               ".webp": "image/webp", ".mp4": "video/mp4", ".mov": "video/quicktime",
               ".webm": "video/webm"}

def load_env():
    env = {}
    f = REPO_ROOT / ".env.local"
    if f.exists():
        for line in f.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env

class Client:
    def __init__(self, base):
        self.base = base
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def req(self, path, data=None, method=None, headers=None, raw=False, absolute=False):
        url = path if absolute else self.base + path
        body = None
        h = {"Accept": "application/json"}
        if headers: h.update(headers)
        if data is not None:
            if isinstance(data, (dict, list)):
                body = json.dumps(data).encode()
                h["Content-Type"] = "application/json"
            elif isinstance(data, bytes):
                body = data
            else:  # form-urlencoded
                body = data.encode()
                h["Content-Type"] = "application/x-www-form-urlencoded"
        r = urllib.request.Request(url, data=body, headers=h, method=method or ("POST" if body else "GET"))
        try:
            with self.opener.open(r, timeout=600) as resp:
                content = resp.read()
                return resp.status, content if raw else (json.loads(content) if content else {})
        except urllib.error.HTTPError as e:
            content = e.read()
            try: return e.code, json.loads(content)
            except Exception: return e.code, {"error": content.decode(errors="replace")[:400]}

    def login(self, email, password):
        _, csrf = self.req("/api/auth/csrf")
        token = csrf.get("csrfToken")
        if not token: sys.exit("Kunde inte hämta CSRF-token — är appen nere?")
        form = urllib.parse.urlencode({"csrfToken": token, "email": email, "password": password,
                                       "redirect": "false", "json": "true"})
        self.req("/api/auth/callback/credentials", data=form, raw=True)
        _, sess = self.req("/api/auth/session")
        if not sess or not sess.get("user"):
            sys.exit("Inloggning misslyckades (fel e-post/lösenord) — uppdatera ADMIN_EMAIL/ADMIN_PASSWORD i .env.local")
        role = sess["user"].get("role")
        if role != "admin": sys.exit(f"Inloggad som {sess['user'].get('email')} men rollen är '{role}' — admin krävs.")
        print(f"✓ Inloggad som {sess['user']['email']} (admin)")

def pick(items, key, needle, what):
    matches = [i for i in items if needle.lower() in (i.get(key) or "").lower()]
    if len(matches) == 1: return matches[0]
    if not matches:
        print(f"\nIngen {what} matchar '{needle}'. Tillgängliga:")
    else:
        print(f"\nFlera {what} matchar '{needle}' — var mer specifik:")
        items = matches
    for i in items[:25]:
        print(f"  - {i.get(key)}  (id: {i.get('id')})")
    sys.exit(1)

def main():
    p = argparse.ArgumentParser()
    p.add_argument("folder"); p.add_argument("template")
    p.add_argument("--campaign", help="substring av kampanjnamn (krävs om ej --adset)")
    p.add_argument("--adset", help="substring av befintligt ad set-namn; utelämna för att skapa nytt från templaten")
    p.add_argument("--dry-run", action="store_true", help="visa vad som skulle postas utan att posta")
    a = p.parse_args()

    folder = Path(a.folder).expanduser()
    if not folder.is_dir(): sys.exit(f"Mappen finns inte: {folder}")
    files = sorted([f for f in folder.iterdir() if f.suffix.lower() in ALLOWED_EXT and not f.name.startswith(".")])
    if not files: sys.exit(f"Inga bilder/videor i {folder} (tillåtna: {', '.join(ALLOWED_EXT)})")

    env = load_env()
    email, pw = env.get("ADMIN_EMAIL"), env.get("ADMIN_PASSWORD")
    if not email or not pw: sys.exit("ADMIN_EMAIL/ADMIN_PASSWORD saknas i .env.local")

    c = Client(BASE_URL)
    c.login(email, pw)

    # Template
    st, t = c.req("/api/templates")
    if st != 200: sys.exit(f"Kunde inte hämta templates: {t}")
    tpl = pick(t.get("data", []), "name", a.template, "template")
    print(f"✓ Template: {tpl['name']}")
    headlines = [h for h in (tpl.get("headlines") or []) if h]
    texts = [x for x in (tpl.get("primaryTexts") or []) if x]
    lps = tpl.get("landingPages") or []
    link_url = (lps[0].get("url") if lps and isinstance(lps[0], dict) else (lps[0] if lps else "")) or ""
    cta = tpl.get("ctaType") or "SHOP_NOW"
    if not link_url: sys.exit("Templaten saknar landing page-URL — lägg till en i appen först.")

    # Kampanj + ev. ad set
    st, camps = c.req("/api/meta/campaigns")
    campaigns = camps.get("data") or camps.get("campaigns") or []
    campaign = pick(campaigns, "name", a.campaign, "kampanj") if a.campaign else None
    adset_id = None
    if a.adset:
        q = f"/api/meta/adsets?campaignId={campaign['id']}" if campaign else "/api/meta/adsets"
        st, adsets = c.req(q)
        adset = pick(adsets.get("data") or adsets.get("adsets") or [], "name", a.adset, "ad set")
        adset_id = adset["id"]
        if not campaign: campaign = {"id": adset.get("campaign_id") or adset.get("campaignId"), "name": "(via ad set)"}
    if not campaign: sys.exit("Ange --campaign (eller --adset).")
    print(f"✓ Kampanj: {campaign['name']}" + (f" | Ad set: {a.adset}" if adset_id else " | Nytt ad set skapas från templaten"))
    print(f"✓ Copy: {len(headlines)} headlines, {len(texts)} texter, CTA {cta} → {link_url}")
    print(f"✓ {len(files)} filer i kö\n")

    if a.dry_run:
        for f in files: print(f"  [dry-run] {f.name}")
        return

    results, errors = [], []
    for i, f in enumerate(files, 1):
        ct = ALLOWED_EXT[f.suffix.lower()]
        media_type = "video" if ct.startswith("video") else "image"
        print(f"[{i}/{len(files)}] {f.name} ({media_type}, {f.stat().st_size//1024} KB)")
        st, ps = c.req("/api/upload/presign", data={"filename": f.name, "contentType": ct,
                                                    "fileSize": f.stat().st_size, "purpose": "library"})
        if st != 200: errors.append((f.name, f"presign: {ps.get('error')}")); print(f"   ✗ presign: {ps.get('error')}"); continue
        up_url, key = ps.get("uploadUrl") or ps.get("url"), ps.get("key") or ps.get("r2Key")
        pub = ps.get("publicUrl") or ps.get("finalPublicUrl") or ""
        st2, _ = c.req(up_url, data=f.read_bytes(), method="PUT", headers={"Content-Type": ct}, raw=True, absolute=True)
        if st2 not in (200, 201): errors.append((f.name, f"R2 PUT {st2}")); print(f"   ✗ R2-uppladdning: {st2}"); continue
        payload = {"r2Key": key, "r2Url": pub, "filename": f.name, "mediaType": media_type,
                   "campaignId": campaign["id"],
                   "adCopy": {"headlines": headlines, "primaryTexts": texts, "linkUrl": link_url, "ctaType": cta},
                   "adName": f.stem}
        if adset_id: payload["adsetId"] = adset_id
        else: payload["adsetConfig"] = {"name": (tpl.get("adsetNameTemplate") or f"{tpl['name']} {f.stem}"),
                                        "dailyBudget": tpl.get("dailyBudget") or 5000,
                                        "targeting": {"geo_locations": {"countries": tpl.get("targetCountries") or ["US"]}},
                                        "optimizationGoal": tpl.get("optimizationGoal") or "OFFSITE_CONVERSIONS",
                                        "bidStrategy": tpl.get("bidStrategy") or "LOWEST_COST_WITHOUT_CAP",
                                        "conversionEvent": tpl.get("conversionEvent") or "PURCHASE"}
        if tpl.get("pixelId"): payload["pixelId"] = tpl["pixelId"]
        st3, res = c.req("/api/meta/upload-from-r2", data=payload)
        if st3 == 200 and res.get("adId"):
            results.append((f.name, res)); print(f"   ✓ annons {res['adId']} (creative {res.get('creativeId')}) — PAUSED")
        else:
            errors.append((f.name, res.get("error", f"HTTP {st3}"))); print(f"   ✗ {res.get('error', st3)}")

    print(f"\nKLART: {len(results)} postade, {len(errors)} fel")
    for n, e in errors: print(f"  ✗ {n}: {e}")

if __name__ == "__main__":
    main()
