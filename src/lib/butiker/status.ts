// The call list's pipeline. Shared by the API (which sets status from a logged
// call) and the page (labels, colours, filters).

export const LEAD_STATUSES = [
  { key: "ny", label: "Ej kontaktad", cls: "bg-slate-500/10 text-slate-300 border-slate-500/20" },
  { key: "inget_svar", label: "Inget svar", cls: "bg-amber-500/10 text-amber-300 border-amber-500/20" },
  { key: "ring_igen", label: "Kontakta igen", cls: "bg-amber-500/10 text-amber-400 border-amber-500/30" },
  { key: "intresserad", label: "Intresserad", cls: "bg-cyan-500/10 text-cyan-300 border-cyan-500/20" },
  { key: "avvakta", label: "Avvakta", cls: "bg-orange-500/10 text-orange-300 border-orange-500/20" },
  { key: "mejla_villkor", label: "Mejla villkor (samtycke)", cls: "bg-sky-500/10 text-sky-300 border-sky-500/20" },
  { key: "mejlad", label: "Mejl skickat", cls: "bg-blue-500/10 text-blue-300 border-blue-500/20" },
  { key: "prov_skickat", label: "Prov skickat", cls: "bg-violet-500/10 text-violet-300 border-violet-500/20" },
  { key: "kund", label: "Kund", cls: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20" },
  { key: "nej", label: "Nej tack", cls: "bg-red-500/10 text-red-300 border-red-500/20" },
  { key: "fel_nummer", label: "Fel nummer / stängd", cls: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20" },
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number]["key"];
export const STATUS_KEYS = new Set<string>(LEAD_STATUSES.map((s) => s.key));
export const statusMeta = (key: string) => LEAD_STATUSES.find((s) => s.key === key) ?? LEAD_STATUSES[0];

/** Call outcomes a caller can pick, and the status each one moves the shop to. */
export const CALL_OUTCOMES: { key: string; label: string; status: LeadStatus; followUpDays?: number }[] = [
  { key: "inget_svar", label: "Inget svar", status: "inget_svar", followUpDays: 2 },
  { key: "ring_igen", label: "Kontakta igen", status: "ring_igen", followUpDays: 3 },
  { key: "intresserad", label: "Intresserad", status: "intresserad", followUpDays: 4 },
  { key: "mejla_villkor", label: "Ja, mejla villkoren", status: "mejla_villkor", followUpDays: 4 },
  { key: "nej", label: "Nej tack", status: "nej" },
  { key: "fel_nummer", label: "Fel nummer", status: "fel_nummer" },
];

export const dedupeKey = (name: string, city: string | null | undefined) =>
  `${name.trim().toLowerCase().replace(/\s+/g, " ")}|${(city ?? "").trim().toLowerCase()}`;

/** Template placeholders, filled per shop when a mail is written. */
export const TEMPLATE_FIELDS: { token: string; label: string }[] = [
  { token: "{butik}", label: "Butikens namn" },
  { token: "{ort}", label: "Ort" },
  { token: "{kunder}", label: "Våra kunder på orten" },
  { token: "{kundrad}", label: "Meningen om kunder på orten (tas bort om orten har färre än 10)" },
];
export const LOCAL_CUSTOMERS_MIN = 10;
type FillLead = { name: string; city: string | null; localCustomers?: number | null };
/** Fill a template for one shop. {kundrad} disappears, with its line, when the town has too few customers. */
export const fillTemplate = (text: string, lead: FillLead) => {
  const n = lead.localCustomers ?? 0;
  const line = n >= LOCAL_CUSTOMERS_MIN && lead.city
    ? `Bara i ${lead.city} har ${n.toLocaleString("sv-SE")} hundägare redan handlat av oss.`
    : "";
  return text
    .replaceAll("{kundrad}", line)
    .replaceAll("{butik}", lead.name)
    .replaceAll("{ort}", lead.city ?? "")
    .replaceAll("{kunder}", n.toLocaleString("sv-SE"))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
};
