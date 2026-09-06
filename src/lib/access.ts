// Who may see what. One list of AREAS drives the sidebar, the page guard in
// middleware, the API guard for people with custom access, and the Access
// page where the superadmin hands out areas per person.
//
// Rules:
//   superadmin            → everything, including /access
//   role admin            → every area except access (permissions can narrow it)
//   role editor           → my-work, timer, review (permissions can widen it)
//   isFounder             → additionally /time
//   permissions (a list)  → exactly those areas, replacing the role default

export interface AreaDef {
  key: string;
  label: string;
  href: string;
  group: "Overview" | "Analyze" | "Launch" | "Workflow" | "Team" | "Founders";
  /** URL prefixes that belong to this area (default: [href]) */
  paths?: string[];
  /** API prefixes this area's pages call — used only for people with custom access */
  apis: string[];
  /** editors get this by default */
  editorDefault?: boolean;
  /** never granted through permissions — needs the flag */
  founderOnly?: boolean;
  superadminOnly?: boolean;
}

export const AREAS: AreaDef[] = [
  { key: "dashboard", label: "Dashboard", href: "/dashboard", group: "Overview", apis: ["/api/meta", "/api/evolve", "/api/shopify"] },
  { key: "learning-loop", label: "Learning Loop", href: "/learning-loop", group: "Overview", apis: ["/api/learning-loop", "/api/assignments", "/api/meta", "/api/brief-templates"] },
  { key: "daily-summary", label: "Daily Summary", href: "/daily-summary", group: "Overview", apis: ["/api/meta", "/api/evolve", "/api/shopify"] },
  { key: "adset-analyzer", label: "Ad Set Analyzer", href: "/adset-analyzer", group: "Analyze", apis: ["/api/meta", "/api/adsets", "/api/adset-owner", "/api/ad-owner", "/api/evolve", "/api/users", "/api/editors"] },
  { key: "campaigns", label: "Campaigns", href: "/campaigns", group: "Analyze", apis: ["/api/meta"] },
  { key: "kpi-settings", label: "KPI Settings", href: "/evolve-settings", group: "Analyze", apis: ["/api/evolve"] },
  { key: "upload", label: "Upload", href: "/upload", group: "Launch", paths: ["/upload", "/upload-log"], apis: ["/api/meta", "/api/upload", "/api/upload-jobs", "/api/r2", "/api/library", "/api/templates", "/api/gdrive", "/api/users", "/api/assignments", "/api/ad-owner"] },
  { key: "templates", label: "Templates", href: "/templates", group: "Launch", apis: ["/api/templates", "/api/meta"] },
  { key: "creatives", label: "Creatives", href: "/creatives", group: "Launch", apis: ["/api/library", "/api/r2", "/api/upload", "/api/meta"] },
  { key: "assignments", label: "Assignments", href: "/assignments", group: "Workflow", apis: ["/api/assignments", "/api/brief-templates", "/api/users", "/api/options", "/api/upload", "/api/review", "/api/meta", "/api/templates"] },
  { key: "my-work", label: "My Work", href: "/my-work", group: "Workflow", apis: ["/api/assignments", "/api/upload", "/api/work", "/api/time-entries"], editorDefault: true },
  { key: "review", label: "Review", href: "/review", group: "Workflow", apis: ["/api/assignments", "/api/review", "/api/upload"], editorDefault: true },
  { key: "timer", label: "Timer", href: "/timer", group: "Workflow", apis: ["/api/time-entries", "/api/work", "/api/assignments"], editorDefault: true },
  { key: "editors", label: "Editors & Bonus", href: "/editors", group: "Team", apis: ["/api/editors", "/api/users", "/api/e", "/api/bank", "/api/fortnox", "/api/adset-owner", "/api/meta"] },
  { key: "scorecards", label: "Scorecards", href: "/scorecards", group: "Team", apis: ["/api/editors", "/api/users"] },
  { key: "options", label: "Options", href: "/options", group: "Team", apis: ["/api/options"] },
  { key: "shopify", label: "Shopify ncROAS", href: "/shopify", group: "Team", apis: ["/api/shopify", "/api/meta"] },
  { key: "settings", label: "Settings", href: "/settings", group: "Team", apis: ["/api/meta", "/api/users", "/api/telegram", "/api/gdrive", "/api/seed"] },
  { key: "time", label: "Time Tracker", href: "/time", group: "Founders", apis: ["/api/time", "/api/work"], founderOnly: true },
  { key: "access", label: "Access", href: "/access", group: "Team", apis: ["/api/access"], superadminOnly: true },
];

export const AREA_BY_KEY = new Map(AREAS.map((a) => [a.key, a]));
export const GRANTABLE_AREAS = AREAS.filter((a) => !a.founderOnly && !a.superadminOnly);

export interface AccessUser {
  role?: string | null;
  isFounder?: boolean | null;
  isSuperadmin?: boolean | null;
  permissions?: string[] | null;
}

/** The set of area keys this person may use. */
export function allowedAreas(user: AccessUser | null | undefined): Set<string> {
  if (!user) return new Set();
  if (user.isSuperadmin) return new Set(AREAS.map((a) => a.key));
  const set = new Set<string>();
  if (Array.isArray(user.permissions)) {
    for (const k of user.permissions) if (AREA_BY_KEY.has(k) && !AREA_BY_KEY.get(k)!.superadminOnly && !AREA_BY_KEY.get(k)!.founderOnly) set.add(k);
  } else if (user.role === "admin") {
    for (const a of GRANTABLE_AREAS) set.add(a.key);
  } else {
    for (const a of AREAS) if (a.editorDefault) set.add(a.key);
  }
  if (user.isFounder) set.add("time");
  return set;
}

/** Custom access (a list) given to someone who is not an admin. */
export function hasCustomAccess(user: AccessUser | null | undefined): boolean {
  return !!user && Array.isArray(user.permissions);
}

/**
 * May this person call admin-level APIs at all? Admins and superadmins yes;
 * an editor with custom access yes — middleware then narrows them to the
 * APIs of their areas. Plain editors no (routes keep their own checks).
 */
export function isElevated(user: AccessUser | null | undefined): boolean {
  if (!user) return false;
  if (user.role === "admin" || user.isSuperadmin) return true;
  return Array.isArray(user.permissions) && user.permissions.some((k) => AREA_BY_KEY.has(k) && !AREA_BY_KEY.get(k)!.editorDefault);
}

const norm = (p: string) => (p.length > 1 ? p.replace(/\/$/, "") : p);
const under = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

/** Which area a page path belongs to (null = not an area: /login, /e/…, /r/…). */
export function areaForPath(pathname: string): AreaDef | null {
  const p = norm(pathname);
  let best: AreaDef | null = null;
  let bestLen = -1;
  for (const a of AREAS) {
    for (const prefix of a.paths ?? [a.href]) {
      if (under(p, prefix) && prefix.length > bestLen) { best = a; bestLen = prefix.length; }
    }
  }
  return best;
}

export function canAccessPath(user: AccessUser | null | undefined, pathname: string): boolean {
  const area = areaForPath(pathname);
  if (!area) return true;
  return allowedAreas(user).has(area.key);
}

/** Which APIs a person with custom access may call. Admins/superadmins: all. */
export function canCallApi(user: AccessUser | null | undefined, pathname: string): boolean {
  if (!user) return false;
  if (user.role === "admin" || user.isSuperadmin) return true;
  if (!hasCustomAccess(user)) return true; // plain editor: routes guard themselves
  const areas = allowedAreas(user);
  for (const a of AREAS) {
    if (!areas.has(a.key)) continue;
    if (a.apis.some((prefix) => under(pathname, prefix))) return true;
  }
  return false;
}

/** Where to send someone who lands on a page they may not see. */
export function homeFor(user: AccessUser | null | undefined): string {
  const areas = allowedAreas(user);
  for (const key of ["dashboard", "my-work", "assignments", "learning-loop", "review", "timer"]) {
    if (areas.has(key)) return AREA_BY_KEY.get(key)!.href;
  }
  const first = AREAS.find((a) => areas.has(a.key));
  return first?.href ?? "/login";
}
