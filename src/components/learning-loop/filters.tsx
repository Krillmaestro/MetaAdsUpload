"use client";

import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { OUTCOME_CONFIG } from "./format";

export interface Filters {
  q: string;
  product: string;
  editor: string;
  format: string;
  role: string;
  outcome: string;
  onlyLive: boolean;
  onlyLinked: boolean;
  missingLearnings: boolean;
}

export const EMPTY_FILTERS: Filters = { q: "", product: "", editor: "", format: "", role: "", outcome: "", onlyLive: false, onlyLinked: false, missingLearnings: false };

export interface FilterableRow {
  productLine: string | null;
  editorName: string | null;
  format: string | null;
  roleLabel: string;
  outcome: string;
  isLive: boolean;
  assignment: unknown | null;
  learnings: string | null;
  judged: boolean;
}

export function hasActiveFilters(f: Filters): boolean {
  return !!(f.q || f.product || f.editor || f.format || f.role || f.outcome || f.onlyLive || f.onlyLinked || f.missingLearnings);
}

/** `searchText` = everything the free-text box should match against for this row. */
export function matchesFilters(r: FilterableRow, f: Filters, searchText: string): boolean {
  const q = f.q.trim().toLowerCase();
  if (q && !searchText.toLowerCase().includes(q)) return false;
  if (f.product && r.productLine !== f.product) return false;
  if (f.editor && r.editorName !== f.editor) return false;
  if (f.format && r.format !== f.format) return false;
  if (f.role && !r.roleLabel.split(" + ").includes(f.role)) return false;
  if (f.outcome && r.outcome !== f.outcome) return false;
  if (f.onlyLive && !r.isLive) return false;
  if (f.onlyLinked && !r.assignment) return false;
  if (f.missingLearnings && (r.learnings || !r.judged)) return false;
  return true;
}

export function filterOptions(rows: FilterableRow[]) {
  const uniq = (get: (r: FilterableRow) => string | null) => [...new Set(rows.map(get).filter((v): v is string => !!v))].sort();
  return {
    products: uniq((r) => r.productLine),
    editors: uniq((r) => r.editorName),
    formats: uniq((r) => r.format),
    roles: [...new Set(rows.flatMap((r) => r.roleLabel.split(" + ")).filter(Boolean))].sort(),
  };
}

function SelectFilter({ value, onChange, options, placeholder }: { value: string; onChange: (v: string) => void; options: string[]; placeholder: string }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn("h-9 rounded-lg border border-white/10 bg-white/5 px-2.5 text-xs outline-none focus:border-cyan-500/50", value ? "text-white" : "text-slate-400")}
    >
      <option value="" className="bg-[#111827]">{placeholder}</option>
      {options.map((o) => <option key={o} value={o} className="bg-[#111827]">{o}</option>)}
    </select>
  );
}

export function FilterBar({
  filters,
  onChange,
  options,
  placeholder,
  shown,
  total,
  unit,
  loading,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  options: ReturnType<typeof filterOptions>;
  placeholder: string;
  shown: number;
  total: number;
  unit: string;
  loading?: boolean;
}) {
  return (
    <div className="rounded-xl border border-white/5 bg-[#111827] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 max-w-[320px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            value={filters.q}
            onChange={(e) => onChange({ ...filters, q: e.target.value })}
            placeholder={placeholder}
            className="h-9 w-full rounded-lg border border-white/10 bg-white/5 pl-9 pr-3 text-xs text-white placeholder:text-slate-600 outline-none focus:border-cyan-500/50"
          />
        </div>
        <SelectFilter value={filters.product} onChange={(v) => onChange({ ...filters, product: v })} options={options.products} placeholder="Alla produkter" />
        <SelectFilter value={filters.editor} onChange={(v) => onChange({ ...filters, editor: v })} options={options.editors} placeholder="Alla editors" />
        <SelectFilter value={filters.format} onChange={(v) => onChange({ ...filters, format: v })} options={options.formats} placeholder="Alla format" />
        <SelectFilter value={filters.role} onChange={(v) => onChange({ ...filters, role: v })} options={options.roles} placeholder="Alla lager" />
        <select
          value={filters.outcome}
          onChange={(e) => onChange({ ...filters, outcome: e.target.value })}
          className={cn("h-9 rounded-lg border border-white/10 bg-white/5 px-2.5 text-xs outline-none focus:border-cyan-500/50", filters.outcome ? "text-white" : "text-slate-400")}
        >
          <option value="" className="bg-[#111827]">Alla utfall</option>
          {Object.entries(OUTCOME_CONFIG).map(([k, v]) => <option key={k} value={k} className="bg-[#111827]">{v.label}</option>)}
        </select>
        {[
          { k: "onlyLive" as const, l: "Bara live" },
          { k: "onlyLinked" as const, l: "Bara med brief" },
          { k: "missingLearnings" as const, l: "Saknar lärdom" },
        ].map((t) => (
          <button
            key={t.k}
            type="button"
            onClick={() => onChange({ ...filters, [t.k]: !filters[t.k] })}
            className={cn("h-9 rounded-lg border px-3 text-xs transition-colors", filters[t.k] ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-300" : "border-white/10 bg-white/5 text-slate-400 hover:text-white")}
          >
            {t.l}
          </button>
        ))}
        {hasActiveFilters(filters) && (
          <button type="button" onClick={() => onChange(EMPTY_FILTERS)} className="inline-flex h-9 items-center gap-1 rounded-lg px-3 text-xs text-slate-400 hover:bg-white/5 hover:text-white">
            <X className="h-3.5 w-3.5" /> Rensa
          </button>
        )}
        <span className="ml-auto text-xs text-slate-500">{shown} av {total} {unit}{loading ? " · uppdaterar…" : ""}</span>
      </div>
    </div>
  );
}
