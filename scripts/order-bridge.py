#!/usr/bin/env python3
"""Order Bridge: speglar betalda oskickade ordrar från gamla ApotekHunden-butiken
(ma3q5a-hd, Seal-prenumerationer) till nya butiken (8e9787-7c, 3PL) och markerar
gamla ordern som skickad. Idempotent via taggen 'bridged' på gamla ordern.

Körning:  python3 bridge.py [--limit N] [--dry-run]
Kräver env: OLD_CLIENT_ID, OLD_CLIENT_SECRET, NEW_CLIENT_ID, NEW_CLIENT_SECRET
(eller creds.env bredvid scriptet)
"""
import json, os, sys, urllib.request

BASE = os.path.dirname(os.path.abspath(__file__))
API = "2026-07"
OLD_SHOP = "ma3q5a-hd.myshopify.com"
NEW_SHOP = "8e9787-7c.myshopify.com"
CUTOFF = "2026-08-01"  # ordrar äldre än detta rörs aldrig (legacy-spökordrar)

# Mappning: gammal butiks line item-titel -> ny butiks variant-GID.
# Okänd titel => ordern hoppas över (och gamla ordern lämnas orörd).
TITLE_MAP = {
    "3-i-1 Probiotika Som Främjar Din Hunds Mag-, Hud- & Energiproblem":
        "gid://shopify/ProductVariant/55573733769551",  # Apotek Hunden - 3-i-1 Probiotika (sku 2, aktiv)
    "3-i-1 Ledtillskott Som Stödjer Din Hunds Rörlighet, Komfort & Livsglädje":
        "gid://shopify/ProductVariant/55810152366415",  # Ledtillskott (aktiv, 399kr)
}
SKIP_TITLES = {"Leverans skydd"}  # fraktskydd: ingen fysisk vara, tas med som custom-rad

# Nya butikens standardfraktsätt — speglade ordrar ska se ut som vanliga ordrar för 3PL
NEW_SHIPPING_TITLE = "Hållbar leverans till postlåda/dörr. ( 1 - 3 dagars leveranstid )"

def env(k):
    if k in os.environ:
        return os.environ[k]
    p = os.path.join(BASE, "creds.env")
    if os.path.exists(p):
        for line in open(p):
            if line.startswith(k + "="):
                return line.strip().split("=", 1)[1]
    raise SystemExit(f"saknar env: {k}")

def get_token(shop, cid, secret):
    req = urllib.request.Request(
        f"https://{shop}/admin/oauth/access_token",
        data=json.dumps({"grant_type": "client_credentials",
                         "client_id": cid, "client_secret": secret}).encode(),
        headers={"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req))["access_token"]

def gql(shop, token, query, variables=None):
    req = urllib.request.Request(
        f"https://{shop}/admin/api/{API}/graphql.json",
        data=json.dumps({"query": query, "variables": variables or {}}).encode(),
        headers={"Content-Type": "application/json", "X-Shopify-Access-Token": token})
    out = json.load(urllib.request.urlopen(req))
    return out

ORDERS_QUERY = """
query($q: String!) { orders(first: 25, query: $q, sortKey: CREATED_AT) { nodes {
  id name createdAt tags email phone taxesIncluded
  totalPriceSet { shopMoney { amount currencyCode } }
  shippingAddress { firstName lastName address1 address2 city zip countryCodeV2 phone company }
  billingAddress { firstName lastName address1 address2 city zip countryCodeV2 phone }
  shippingLine { title originalPriceSet { shopMoney { amount } } }
  lineItems(first: 15) { nodes { title quantity sku
    discountedUnitPriceSet { shopMoney { amount } } } }
  fulfillmentOrders(first: 5) { nodes { id status } }
} } }"""

ORDER_CREATE = """
mutation($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
  orderCreate(order: $order, options: $options) {
    order { id name totalPriceSet { shopMoney { amount } } }
    userErrors { field message } } }"""

FULFILL = """
mutation($f: FulfillmentInput!) {
  fulfillmentCreate(fulfillment: $f) {
    fulfillment { id status }
    userErrors { field message } } }"""

TAG_ADD = """
mutation($id: ID!, $tags: [String!]!) {
  tagsAdd(id: $id, tags: $tags) { userErrors { field message } } }"""

def addr(a):
    if not a:
        return None
    return {k: v for k, v in {
        "firstName": a.get("firstName"), "lastName": a.get("lastName"),
        "address1": a.get("address1"), "address2": a.get("address2"),
        "city": a.get("city"), "zip": a.get("zip"),
        "countryCode": a.get("countryCodeV2"), "phone": a.get("phone"),
        "company": a.get("company")}.items() if v}

def main():
    dry = "--dry-run" in sys.argv
    limit = 100
    if "--limit" in sys.argv:
        limit = int(sys.argv[sys.argv.index("--limit") + 1])

    old_tok = get_token(OLD_SHOP, env("OLD_CLIENT_ID"), env("OLD_CLIENT_SECRET"))
    new_tok = get_token(NEW_SHOP, env("NEW_CLIENT_ID"), env("NEW_CLIENT_SECRET"))

    q = f"fulfillment_status:unfulfilled financial_status:paid created_at:>{CUTOFF} -tag:bridged"
    if "--query" in sys.argv:
        q = sys.argv[sys.argv.index("--query") + 1]
    data = gql(OLD_SHOP, old_tok, ORDERS_QUERY, {"q": q})
    orders = data.get("data", {}).get("orders", {}).get("nodes", [])
    print(f"{len(orders)} ordrar att spegla (limit {limit})")

    done = skipped = failed = 0
    for o in orders[:limit]:
        name = o["name"]
        if "bridged" in (o.get("tags") or []):
            continue
        cur = o["totalPriceSet"]["shopMoney"]["currencyCode"]
        line_items = []
        unknown = None
        for li in o["lineItems"]["nodes"]:
            price = {"shopMoney": {"amount": li["discountedUnitPriceSet"]["shopMoney"]["amount"],
                                   "currencyCode": cur}}
            if li["title"] in SKIP_TITLES:
                line_items.append({"title": li["title"], "quantity": li["quantity"],
                                   "priceSet": price, "requiresShipping": False})
            elif li["title"] in TITLE_MAP:
                line_items.append({"variantId": TITLE_MAP[li["title"]],
                                   "quantity": li["quantity"], "priceSet": price,
                                   "requiresShipping": True})
            else:
                unknown = li["title"]
        if unknown:
            print(f"  SKIP {name}: okänd produkt '{unknown}' — lägg till i TITLE_MAP")
            skipped += 1
            continue

        order_input = {
            "email": o.get("email"),
            "tags": ["bridge", f"bridge:{name}"],
            "note": f"Speglad från gamla butiken {name} (prenumeration). Skapad av Order Bridge.",
            "financialStatus": "PAID",
            "currency": cur,
            "taxesIncluded": bool(o.get("taxesIncluded")),
            "lineItems": line_items,
            "shippingAddress": addr(o.get("shippingAddress")),
            "billingAddress": addr(o.get("billingAddress") or o.get("shippingAddress")),
        }
        sl = o.get("shippingLine")
        ship_amount = sl["originalPriceSet"]["shopMoney"]["amount"] if sl else "0.0"
        order_input["shippingLines"] = [{
            "title": NEW_SHIPPING_TITLE,
            "priceSet": {"shopMoney": {"amount": ship_amount, "currencyCode": cur}}}]
        order_input = {k: v for k, v in order_input.items() if v is not None}

        if dry:
            print(f"  DRY {name}: {json.dumps(order_input, ensure_ascii=False)[:200]}...")
            continue

        r = gql(NEW_SHOP, new_tok, ORDER_CREATE, {
            "order": order_input,
            "options": {"inventoryBehaviour": "DECREMENT_IGNORING_POLICY",
                        "sendReceipt": False, "sendFulfillmentReceipt": False}})
        payload = r.get("data", {}).get("orderCreate") or {}
        errs = payload.get("userErrors") or r.get("errors")
        if errs or not payload.get("order"):
            print(f"  FAIL {name}: {json.dumps(errs, ensure_ascii=False)}")
            failed += 1
            continue
        new_name = payload["order"]["name"]
        new_total = payload["order"]["totalPriceSet"]["shopMoney"]["amount"]
        print(f"  OK {name} -> ny order {new_name} ({new_total} {cur})")

        # Markera gamla ordern som skickad (utan kundnotis) + tagga bridged
        fo_ids = [f["id"] for f in o["fulfillmentOrders"]["nodes"]
                  if f["status"] in ("OPEN", "IN_PROGRESS")]
        for fo in fo_ids:
            fr = gql(OLD_SHOP, old_tok, FULFILL, {
                "f": {"lineItemsByFulfillmentOrder": [{"fulfillmentOrderId": fo}],
                      "notifyCustomer": False}})
            fp = fr.get("data", {}).get("fulfillmentCreate") or {}
            fe = fp.get("userErrors") or fr.get("errors")
            if fe:
                print(f"    VARNING fulfill {name}: {json.dumps(fe, ensure_ascii=False)}")
        tr = gql(OLD_SHOP, old_tok, TAG_ADD, {"id": o["id"], "tags": ["bridged", f"bridge-to:{new_name}"]})
        te = (tr.get("data", {}).get("tagsAdd") or {}).get("userErrors") or tr.get("errors")
        if te:
            print(f"    VARNING tagg {name}: {json.dumps(te, ensure_ascii=False)}")
        done += 1

    print(f"\nKLART: {done} speglade, {skipped} skippade, {failed} fel")
    if failed:
        sys.exit(1)

if __name__ == "__main__":
    main()
