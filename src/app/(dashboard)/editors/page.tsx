"use client";

import { useState, useEffect, useCallback } from "react";
import { format, subDays } from "date-fns";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  RefreshCw,
  DollarSign,
  TrendingUp,
  Trophy,
  ChevronDown,
  ChevronRight,
  Users,
  Banknote,
  Check,
  Clock,
  AlertCircle,
  Plus,
  Video,
  Lightbulb,
  Eye,
  EyeOff,
  Copy,
  ExternalLink,
  Medal,
  Flame,
  BarChart3,
  Skull,
  CloudDownload,
  Pencil,
  X,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { bonusTierColor, type BonusTier } from "@/lib/bonus";

interface EditorAd {
  id: string;
  name: string;
  spend: number;
  roas: number;
  ctr: number;
  hookRate: number;
  holdRate: number;
  purchases: number;
  angle: string | null;
  problem: string | null;
  templateName: string | null;
}

interface EditorAdset {
  adsetId: string;
  adsetName: string;
  campaignId: string | null;
  strategistName: string | null;
  spend: number;
  roas: number;
  ctr: number;
  hookRate: number;
  holdRate: number;
  purchases: number;
  bonus: number;
  bonusTier: number;
  tierLog: Record<string, string>;
  paidForAdset: number;
  outstanding: number;
  lifetimeSpend: number;
  lifetimeRoas: number;
  isWinner: boolean;
  graveyardOutcome: string | null;
  adCount: number;
  ads: EditorAd[];
}

interface Payout {
  id: number;
  editorId: string;
  amount: number;
  currency: string;
  periodFrom: string;
  periodTo: string;
  status: string;
  paidAt: string | null;
  notes: string | null;
  breakdown: Array<{ adId: string; adName: string; spend: number; roas: number; bonus: number }>;
}

interface EditorData {
  editorId: string;
  editor: string;
  fullName: string;
  slug: string | null;
  userType: string;
  totalSpend: number;
  totalPurchaseValue: number;
  totalPurchases: number;
  totalImpressions: number;
  roas: number;
  ctr: number;
  hookRate: number;
  totalBonus: number;
  paidAmount: number;
  pendingAmount: number;
  unpaidAmount: number;
  adsetCount: number;
  winnerCount: number;
  graveyardSpendWinners: number;
  graveyardLosers: number;
  angleStats: Array<{ angle: string; ads: number; winners: number }>;
  adsets: EditorAdset[];
  payouts: Payout[];
}

interface LeaderEntry { editorId: string; name: string; slug: string | null; winners: number; hookRate: number; earned: number }
interface StrategistStat { id: string; name: string; slug: string | null; ads: number; winners: number; winRate: number }
interface TemplateStat { templateId: number; templateName: string; ads: number; winners: number; winRate: number; spend: number; roas: number }
interface PerfRow { name: string; ads: number; winners: number; winRate: number; spend: number; roas: number }
interface Member { id: string; name: string; email?: string; userType?: string; isActive?: boolean }
type Series = Array<{ date: string; spend: number; revenue: number; roas: number; purchases: number }>;

function PerfTable({ title, label, rows }: { title: string; label: string; rows: PerfRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="rounded-xl border border-white/5 bg-[#111827] overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-white/5">
        <BarChart3 className="h-4 w-4 text-cyan-400" />
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <span className="text-xs text-slate-600">best → worst by ROAS</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/5">
              {[label, "Ads", "Winners", "Win rate", "Spend", "ROAS"].map((h, i) => (
                <th key={h} className={cn("px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider", i > 0 && "text-right")}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...rows].sort((a, b) => b.roas - a.roas || b.winners - a.winners).map((r) => (
              <tr key={r.name} className="border-b border-white/5 hover:bg-white/[0.02]">
                <td className="px-4 py-3 text-sm text-slate-200">{r.name}</td>
                <td className="px-4 py-3 text-right text-sm text-slate-400">{r.ads}</td>
                <td className="px-4 py-3 text-right text-sm text-amber-400">{r.winners}</td>
                <td className="px-4 py-3 text-right text-sm text-slate-400">{r.winRate.toFixed(0)}%</td>
                <td className="px-4 py-3 text-right text-sm text-slate-400">${fmt(r.spend)}</td>
                <td className="px-4 py-3 text-right text-sm font-semibold">
                  <span className={r.roas >= 2.5 ? "text-emerald-400" : r.roas >= 2.0 ? "text-amber-400" : r.roas > 0 ? "text-red-400" : "text-slate-600"}>{r.roas.toFixed(2)}x</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function fmt(n: number, decimals = 0): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function BonusBadge({ bonus }: { bonus: number }) {
  if (bonus === 0) return <span className="text-slate-500 text-sm">-</span>;
  return (
    <Badge variant="outline" className={bonusTierColor(bonus)}>
      <Trophy className="h-3 w-3 mr-1" />${bonus}
    </Badge>
  );
}

/** Per-ad ladder showing every bonus tier the ad has reached (locked, in order). */
function TierLadder({ tierLog, tiers }: { tierLog: Record<string, string>; tiers: BonusTier[] }) {
  const ladder = [...tiers].map((t) => t.bonus).sort((a, b) => a - b);
  if (ladder.length === 0) return null;
  return (
    <div className="flex items-center gap-1 mt-1 flex-wrap">
      {ladder.map((t) => {
        const hit = tierLog?.[String(t)];
        return (
          <span
            key={t}
            title={hit ? `$${t} reached ${hit}` : `$${t} not reached yet`}
            className={"rounded px-1 py-0.5 text-[9px] font-bold border " + (hit ? bonusTierColor(t) : "bg-white/[0.02] text-slate-600 border-white/5")}
          >
            ${t}{hit ? " ✓" : ""}
          </span>
        );
      })}
    </div>
  );
}

function PayoutStatusBadge({ status }: { status: string }) {
  if (status === "paid") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
        <Check className="h-3 w-3" /> Paid
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
      <Clock className="h-3 w-3" /> Pending
    </span>
  );
}

function EditorRow({
  editor,
  series,
  tiers,
  onExpand,
  onCreatePayout,
  onMarkPaid,
}: {
  editor: EditorData;
  series: Series | undefined;
  tiers: BonusTier[];
  onExpand: (editorId: string) => void;
  onCreatePayout: (editor: EditorData) => void;
  onMarkPaid: (payoutId: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next) onExpand(editor.editorId);
  };

  const copyLink = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!editor.slug) return;
    const url = `${window.location.origin}/e/${editor.slug}`;
    navigator.clipboard.writeText(url);
    toast.success(`Link copied: /e/${editor.slug}`);
  };

  return (
    <>
      <tr className="border-b border-white/5 cursor-pointer hover:bg-white/[0.02] transition-colors" onClick={toggle}>
        <td className="px-4 py-3 font-medium text-slate-200">
          <div className="flex items-center gap-2">
            {expanded ? <ChevronDown className="h-4 w-4 text-slate-500" /> : <ChevronRight className="h-4 w-4 text-slate-500" />}
            {editor.userType === "creative_strategist" ? (
              <Lightbulb className="h-3.5 w-3.5 text-purple-400" />
            ) : (
              <Video className="h-3.5 w-3.5 text-cyan-400" />
            )}
            {editor.fullName}
            <span className="text-xs text-slate-500">({editor.adsetCount} ad sets)</span>
          </div>
        </td>
        <td className="px-4 py-3 text-right text-sm text-amber-400 font-medium">{editor.winnerCount}</td>
        <td className="px-4 py-3 text-right text-sm text-slate-300">${fmt(editor.totalSpend, 2)}</td>
        <td className="px-4 py-3 text-right text-sm font-semibold">
          <span className={editor.roas >= 2.5 ? "text-emerald-400" : editor.roas >= 2.0 ? "text-amber-400" : "text-red-400"}>
            {editor.roas.toFixed(2)}x
          </span>
        </td>
        <td className="px-4 py-3 text-right text-sm text-slate-400">{editor.hookRate.toFixed(1)}%</td>
        <td className="px-4 py-3 text-right">
          <span className="font-semibold text-emerald-400">${fmt(editor.totalBonus)}</span>
        </td>
        <td className="px-4 py-3 text-right">
          <div className="flex items-center justify-end gap-2">
            {editor.paidAmount > 0 && <span className="text-xs text-emerald-400">${fmt(editor.paidAmount)} paid</span>}
            {editor.unpaidAmount > 0 && (
              <button
                onClick={(e) => { e.stopPropagation(); onCreatePayout(editor); }}
                className="text-[10px] font-medium px-2 py-1 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 hover:bg-cyan-500/20 transition-all"
              >
                Pay ${fmt(editor.unpaidAmount)}
              </button>
            )}
          </div>
        </td>
        <td className="px-4 py-3 text-right">
          {editor.slug && (
            <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
              <button onClick={copyLink} title="Copy public link" className="p-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-400 hover:text-cyan-400 hover:bg-white/10 transition-all">
                <Copy className="h-3.5 w-3.5" />
              </button>
              <a href={`/e/${editor.slug}`} target="_blank" rel="noreferrer" title="Open public page" className="p-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-400 hover:text-cyan-400 hover:bg-white/10 transition-all">
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-white/5 bg-white/[0.01]">
          <td colSpan={8} className="px-4 py-4">
            {/* Performance graph */}
            <div className="rounded-xl border border-white/5 bg-[#0f1629] p-4 mb-4">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="h-4 w-4 text-cyan-400" />
                <span className="text-xs font-semibold text-white">Performance over time</span>
                <span className="text-[10px] text-slate-600">spend (bars) &amp; ROAS (line)</span>
              </div>
              {series === undefined ? (
                <div className="py-10 text-center text-xs text-slate-600">Loading chart...</div>
              ) : series.length === 0 ? (
                <div className="py-10 text-center text-xs text-slate-600">No data in this period.</div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <ComposedChart data={series} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 10 }} tickFormatter={(d) => String(d).slice(5)} />
                    <YAxis yAxisId="left" tick={{ fill: "#64748b", fontSize: 10 }} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fill: "#64748b", fontSize: 10 }} />
                    <Tooltip contentStyle={{ background: "#0f1629", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, fontSize: 12 }} labelStyle={{ color: "#e2e8f0" }} />
                    <ReferenceLine yAxisId="right" y={2.0} stroke="#f59e0b" strokeDasharray="4 4" />
                    <Bar yAxisId="left" dataKey="spend" name="Spend ($)" fill="#8b5cf6" radius={[3, 3, 0, 0]} maxBarSize={26} />
                    <Line yAxisId="right" type="monotone" dataKey="roas" name="ROAS" stroke="#34d399" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Graveyard + angle summary */}
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-blue-500/20 bg-blue-500/5 px-2.5 py-1 text-[11px] text-blue-400">
                <Skull className="h-3 w-3" /> {editor.graveyardSpendWinners} spend winners
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/5 px-2.5 py-1 text-[11px] text-red-400">
                <Skull className="h-3 w-3" /> {editor.graveyardLosers} losers
              </span>
              {editor.angleStats.slice(0, 4).map((a) => (
                <span key={a.angle} className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-400">
                  {a.angle}: <span className="text-amber-400">{a.winners}</span>/{a.ads}
                </span>
              ))}
            </div>

            {/* Ad sets (each with its ads) */}
            <div className="space-y-3">
              {editor.adsets.map((s) => (
                <div key={s.adsetId} className="rounded-xl border border-white/5 overflow-hidden">
                  <div className="flex items-center gap-3 px-3 py-2.5 bg-white/[0.02] flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-medium text-slate-200 truncate max-w-[260px]">{s.adsetName}</span>
                        {s.strategistName && <span className="text-[10px] text-purple-400/70">💡 {s.strategistName}</span>}
                        {s.graveyardOutcome === "spend_winner" && <span className="text-[10px] text-blue-400">⚰ spend winner</span>}
                        {s.graveyardOutcome === "loser" && <span className="text-[10px] text-red-400">⚰ loser</span>}
                      </div>
                      {s.bonus > 0 && <TierLadder tierLog={s.tierLog} tiers={tiers} />}
                    </div>
                    <div className="flex items-center gap-4 text-[11px] shrink-0">
                      <span className="text-slate-500">${fmt(s.lifetimeSpend)} / {s.lifetimeRoas.toFixed(1)}x life</span>
                      <span className="text-slate-400">${fmt(s.spend)}</span>
                      <span className={s.roas >= 2.5 ? "text-emerald-400" : s.roas >= 2.0 ? "text-amber-400" : s.spend > 0 ? "text-red-400" : "text-slate-600"}>{s.roas.toFixed(2)}x</span>
                      <span className={cn(s.hookRate >= 30 ? "text-emerald-400" : s.hookRate >= 20 ? "text-amber-400" : s.hookRate > 0 ? "text-red-400" : "text-slate-600")}>{s.hookRate.toFixed(0)}% hook</span>
                      <BonusBadge bonus={s.bonus} />
                    </div>
                  </div>
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-white/5">
                        {["Ad", "Angle", "Spend", "ROAS", "Hook", "Hold", "Purch."].map((h, i) => (
                          <th key={h} className={cn("px-3 py-1.5 text-[9px] font-medium text-slate-500 uppercase tracking-wider", i > 1 ? "text-right" : "text-left")}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {s.ads.map((ad) => (
                        <tr key={ad.id} className="border-b border-white/[0.03]">
                          <td className="px-3 py-1.5 text-xs text-slate-400 max-w-[220px] truncate">{ad.name}</td>
                          <td className="px-3 py-1.5 text-xs text-slate-500 max-w-[110px] truncate" title={ad.problem || undefined}>{ad.angle || "—"}</td>
                          <td className="px-3 py-1.5 text-right text-xs text-slate-400">${fmt(ad.spend)}</td>
                          <td className="px-3 py-1.5 text-right text-xs"><span className={ad.roas >= 2.5 ? "text-emerald-400" : ad.roas >= 2.0 ? "text-amber-400" : ad.spend > 0 ? "text-red-400" : "text-slate-600"}>{ad.roas.toFixed(2)}x</span></td>
                          <td className={cn("px-3 py-1.5 text-right text-xs", ad.hookRate >= 30 ? "text-emerald-400" : ad.hookRate >= 20 ? "text-amber-400" : ad.hookRate > 0 ? "text-red-400" : "text-slate-600")}>{ad.hookRate.toFixed(1)}%</td>
                          <td className={cn("px-3 py-1.5 text-right text-xs", ad.holdRate >= 50 ? "text-emerald-400" : ad.holdRate >= 40 ? "text-amber-400" : ad.holdRate > 0 ? "text-red-400" : "text-slate-600")}>{ad.holdRate.toFixed(1)}%</td>
                          <td className="px-3 py-1.5 text-right text-xs text-slate-400">{ad.purchases}</td>
                        </tr>
                      ))}
                      {s.ads.length === 0 && <tr><td colSpan={7} className="px-3 py-3 text-center text-[11px] text-slate-600">No ad data synced yet.</td></tr>}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>

            {/* Payout history */}
            {editor.payouts.length > 0 && (
              <div className="mt-4">
                <div className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">Payout history</div>
                <div className="space-y-1.5">
                  {editor.payouts.map((p) => (
                    <div key={p.id} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-3">
                        <PayoutStatusBadge status={p.status} />
                        <span className="text-slate-300 font-medium">${fmt(p.amount, 2)}</span>
                        <span className="text-xs text-slate-500">{p.periodFrom} — {p.periodTo}</span>
                        {p.notes && <span className="text-xs text-slate-600 italic">{p.notes}</span>}
                      </div>
                      {p.status === "pending" && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onMarkPaid(p.id); }}
                          className="flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 transition-all"
                        >
                          <Check className="h-3 w-3" /> Mark paid
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export default function EditorsPage() {
  const [dateRange, setDateRange] = useState({ from: subDays(new Date(), 30), to: new Date() });
  const [editors, setEditors] = useState<EditorData[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderEntry[]>([]);
  const [strategists, setStrategists] = useState<StrategistStat[]>([]);
  const [templates, setTemplates] = useState<TemplateStat[]>([]);
  const [anglePerf, setAnglePerf] = useState<PerfRow[]>([]);
  const [problemPerf, setProblemPerf] = useState<PerfRow[]>([]);
  const [allMembers, setAllMembers] = useState<Member[]>([]);
  const [bonusTiers, setBonusTiers] = useState<BonusTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [seriesByEditor, setSeriesByEditor] = useState<Record<string, Series>>({});

  // Editable bonus tiers
  const [editingTiers, setEditingTiers] = useState(false);
  const [tierDraft, setTierDraft] = useState<BonusTier[]>([]);
  const [savingTiers, setSavingTiers] = useState(false);

  const [showPayoutModal, setShowPayoutModal] = useState(false);
  const [payoutEditor, setPayoutEditor] = useState<EditorData | null>(null);
  const [payoutNotes, setPayoutNotes] = useState("");
  const [creatingPayout, setCreatingPayout] = useState(false);

  const [showCreateMember, setShowCreateMember] = useState(false);
  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [newMemberPassword, setNewMemberPassword] = useState("");
  const [newMemberType, setNewMemberType] = useState<"video_editor" | "creative_strategist">("video_editor");
  const [showPassword, setShowPassword] = useState(false);
  const [creatingMember, setCreatingMember] = useState(false);
  const [createError, setCreateError] = useState("");

  const fetchEditors = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        from: format(dateRange.from, "yyyy-MM-dd"),
        to: format(dateRange.to, "yyyy-MM-dd"),
      });
      const res = await fetch(`/api/editors?${params}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setEditors(data.editors || []);
      setLeaderboard(data.leaderboard || []);
      setStrategists(data.strategists || []);
      setTemplates(data.templates || []);
      setAnglePerf(data.angles || []);
      setProblemPerf(data.problems || []);
      setBonusTiers(data.bonusTiers || []);
      setSeriesByEditor({});
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [dateRange]);

  useEffect(() => { fetchEditors(); }, [fetchEditors]);

  const fetchMembers = useCallback(async () => {
    try {
      const res = await fetch("/api/users");
      if (!res.ok) return;
      const { users } = await res.json();
      setAllMembers((users || []).filter((u: Member) => u.isActive !== false));
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { fetchMembers(); }, [fetchMembers]);

  const removeMember = async (m: Member) => {
    if (!confirm(`Remove ${m.name}? (deactivated — bonus history is kept)`)) return;
    try {
      const res = await fetch(`/api/users/${m.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed");
      toast.success(`${m.name} removed`);
      fetchMembers();
      fetchEditors();
    } catch {
      toast.error("Could not remove member");
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/editors/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sync failed");
      const pending = data.synced?.backfillsPending ?? 0;
      toast.success(
        `Synced from Meta: ${data.synced?.adInsightRows ?? 0} ad rows, ${data.synced?.ads ?? 0} ads` +
        (data.synced?.backfilled ? `, ${data.synced.backfilled} lifetime backfills` : "") +
        (pending > 0 ? ` — ${pending} ad sets still need backfill, run sync again` : "")
      );
      fetchEditors();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const loadSeries = useCallback(async (editorId: string) => {
    if (seriesByEditor[editorId]) return;
    try {
      const params = new URLSearchParams({
        editorId,
        from: format(dateRange.from, "yyyy-MM-dd"),
        to: format(dateRange.to, "yyyy-MM-dd"),
      });
      const res = await fetch(`/api/editors/timeseries?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      setSeriesByEditor((prev) => ({ ...prev, [editorId]: data.timeseries || [] }));
    } catch { /* ignore */ }
  }, [dateRange, seriesByEditor]);

  // ── Bonus tier editing ──
  const startEditTiers = () => {
    setTierDraft(bonusTiers.length > 0 ? bonusTiers.map((t) => ({ ...t })) : []);
    setEditingTiers(true);
  };
  const updateTier = (i: number, field: keyof BonusTier, value: number) => {
    setTierDraft((prev) => prev.map((t, idx) => (idx === i ? { ...t, [field]: value } : t)));
  };
  const addTier = () => setTierDraft((prev) => [...prev, { bonus: 0, minSpend: 0, minRoas: 2.0 }]);
  const removeTier = (i: number) => setTierDraft((prev) => prev.filter((_, idx) => idx !== i));
  const saveTiers = async () => {
    setSavingTiers(true);
    try {
      const cleaned = tierDraft
        .map((t) => ({ bonus: Number(t.bonus) || 0, minSpend: Number(t.minSpend) || 0, minRoas: Number(t.minRoas) || 0 }))
        .filter((t) => t.bonus > 0)
        .sort((a, b) => b.bonus - a.bonus);
      const res = await fetch("/api/evolve/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bonusTiers: cleaned }),
      });
      if (!res.ok) throw new Error("Failed to save tiers");
      setBonusTiers(cleaned);
      setEditingTiers(false);
      toast.success("Bonus tiers saved — recalculated on next refresh/sync");
      fetchEditors();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save tiers");
    } finally {
      setSavingTiers(false);
    }
  };

  const handleCreatePayout = (editor: EditorData) => {
    setPayoutEditor(editor);
    setPayoutNotes("");
    setShowPayoutModal(true);
  };

  const handleSubmitPayout = async () => {
    if (!payoutEditor) return;
    setCreatingPayout(true);
    try {
      const unpaid = payoutEditor.adsets.filter((s) => s.outstanding > 0);
      const breakdown = unpaid.map((s) => ({ adId: s.adsetId, adName: s.adsetName, spend: s.lifetimeSpend, roas: s.lifetimeRoas, bonus: s.outstanding }));
      const res = await fetch("/api/editors/payouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          editorId: payoutEditor.editorId,
          amount: payoutEditor.unpaidAmount,
          periodFrom: format(dateRange.from, "yyyy-MM-dd"),
          periodTo: format(dateRange.to, "yyyy-MM-dd"),
          adIds: unpaid.map((s) => s.adsetId),
          breakdown,
          notes: payoutNotes || null,
        }),
      });
      if (!res.ok) throw new Error("Failed to create payout");
      toast.success(`Payout of $${fmt(payoutEditor.unpaidAmount)} created for ${payoutEditor.editor}`);
      setShowPayoutModal(false);
      fetchEditors();
    } catch {
      toast.error("Could not create payout");
    } finally {
      setCreatingPayout(false);
    }
  };

  const handleMarkPaid = async (payoutId: number) => {
    try {
      const res = await fetch("/api/editors/payouts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: payoutId, status: "paid" }),
      });
      if (!res.ok) throw new Error("Failed");
      toast.success("Payout marked as paid");
      fetchEditors();
    } catch {
      toast.error("Could not update payout");
    }
  };

  const handleCreateMember = async () => {
    setCreateError("");
    if (!newMemberName.trim() || !newMemberEmail.trim() || !newMemberPassword) {
      setCreateError("All fields are required");
      return;
    }
    if (newMemberPassword.length < 8) {
      setCreateError("Password must be at least 8 characters");
      return;
    }
    setCreatingMember(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newMemberName.trim(),
          email: newMemberEmail.trim().toLowerCase(),
          password: newMemberPassword,
          userType: newMemberType,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Could not create member");
      }
      toast.success(`${newMemberName.trim()} added as ${newMemberType === "video_editor" ? "Video Editor" : "Creative Strategist"}`);
      setShowCreateMember(false);
      setNewMemberName("");
      setNewMemberEmail("");
      setNewMemberPassword("");
      setNewMemberType("video_editor");
      setShowPassword(false);
      fetchEditors();
      fetchMembers();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Could not create member");
    } finally {
      setCreatingMember(false);
    }
  };

  const totalSpend = editors.reduce((s, e) => s + e.totalSpend, 0);
  const totalRevenue = editors.reduce((s, e) => s + e.totalPurchaseValue, 0);
  const totalBonus = editors.reduce((s, e) => s + e.totalBonus, 0);
  const totalPaid = editors.reduce((s, e) => s + e.paidAmount, 0);
  const totalUnpaid = editors.reduce((s, e) => s + e.unpaidAmount, 0);
  const overallRoas = totalSpend > 0 ? totalRevenue / totalSpend : 0;
  const tiersSorted = [...bonusTiers].sort((a, b) => a.bonus - b.bonus);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Users className="h-6 w-6 text-cyan-400" />
            Editor Performance
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">Performance, lifetime bonus &amp; payouts per video editor</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <DateRangePicker from={dateRange.from} to={dateRange.to} onChange={setDateRange} />
          <button onClick={fetchEditors} disabled={loading} className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-slate-300 hover:bg-white/10 hover:text-white transition-all disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button onClick={handleSync} disabled={syncing} title="Pull the latest spend/ROAS/video data from Meta" className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-slate-300 hover:bg-white/10 hover:text-white transition-all disabled:opacity-50">
            <CloudDownload className={`h-4 w-4 ${syncing ? "animate-pulse text-cyan-400" : ""}`} />
            {syncing ? "Syncing..." : "Sync Meta"}
          </button>
          <button onClick={() => setShowCreateMember(true)} className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-700 text-sm font-medium text-white transition-all">
            <Users className="h-4 w-4" />
            Manage team
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-5">
        {[
          { title: "Editors", value: loading ? "..." : editors.length, icon: Users, iconBg: "bg-cyan-500/10", iconColor: "text-cyan-400" },
          { title: "Spend", value: loading ? "..." : `$${fmt(totalSpend, 0)}`, icon: DollarSign, iconBg: "bg-purple-500/10", iconColor: "text-purple-400" },
          { title: "ROAS", value: loading ? "..." : `${overallRoas.toFixed(2)}x`, icon: TrendingUp, iconBg: "bg-emerald-500/10", iconColor: "text-emerald-400" },
          { title: "Bonus (lifetime)", value: loading ? "..." : `$${fmt(totalBonus)}`, icon: Trophy, iconBg: "bg-amber-500/10", iconColor: "text-amber-400", valueColor: "text-emerald-400" },
          { title: "Outstanding", value: loading ? "..." : `$${fmt(totalUnpaid)}`, icon: AlertCircle, iconBg: totalUnpaid > 0 ? "bg-red-500/10" : "bg-white/5", iconColor: totalUnpaid > 0 ? "text-red-400" : "text-slate-500", valueColor: totalUnpaid > 0 ? "text-red-400" : "text-slate-400" },
        ].map((card) => (
          <div key={card.title} className="rounded-xl border border-white/5 bg-[#111827] p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">{card.title}</span>
              <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center", card.iconBg)}>
                <card.icon className={cn("h-4 w-4", card.iconColor)} />
              </div>
            </div>
            <div className={cn("text-2xl font-bold", card.valueColor || "text-white", loading && "animate-pulse")}>{card.value}</div>
          </div>
        ))}
      </div>

      {/* Paid / Outstanding */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5">
          <div className="flex items-center gap-2 mb-2">
            <Banknote className="h-4 w-4 text-emerald-400" />
            <span className="text-xs font-medium text-emerald-400 uppercase tracking-wider">Total paid</span>
          </div>
          <div className="text-3xl font-bold text-emerald-400">{loading ? "..." : `$${fmt(totalPaid)}`}</div>
          <p className="text-xs text-slate-500 mt-1">Bonuses marked as paid</p>
        </div>
        <div className={cn("rounded-xl border p-5", totalUnpaid > 0 ? "border-amber-500/20 bg-amber-500/5" : "border-white/5 bg-[#111827]")}>
          <div className="flex items-center gap-2 mb-2">
            <Clock className={cn("h-4 w-4", totalUnpaid > 0 ? "text-amber-400" : "text-slate-500")} />
            <span className={cn("text-xs font-medium uppercase tracking-wider", totalUnpaid > 0 ? "text-amber-400" : "text-slate-500")}>Outstanding</span>
          </div>
          <div className={cn("text-3xl font-bold", totalUnpaid > 0 ? "text-amber-400" : "text-slate-500")}>{loading ? "..." : `$${fmt(totalUnpaid)}`}</div>
          <p className="text-xs text-slate-500 mt-1">Earned bonus not yet paid out</p>
        </div>
      </div>

      {/* Leaderboard + Strategists */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-white/5 bg-[#111827] overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-4 border-b border-white/5">
            <Medal className="h-4 w-4 text-amber-400" />
            <h3 className="text-sm font-semibold text-white">Leaderboard — most winners</h3>
          </div>
          <div className="divide-y divide-white/5">
            {leaderboard.length === 0 && <p className="px-5 py-6 text-center text-sm text-slate-600">No data yet.</p>}
            {leaderboard.slice(0, 6).map((l, i) => (
              <div key={l.editorId} className="flex items-center gap-3 px-5 py-2.5">
                <span className={cn("w-5 text-center text-sm font-bold", i === 0 ? "text-yellow-400" : i === 1 ? "text-slate-300" : i === 2 ? "text-amber-600" : "text-slate-600")}>{i + 1}</span>
                <span className="flex-1 text-sm text-slate-300">{l.name}</span>
                <span className="flex items-center gap-1 text-xs text-slate-500"><Flame className="h-3 w-3" />{l.hookRate.toFixed(1)}%</span>
                <span className="flex items-center gap-1 text-sm font-semibold text-amber-400"><Trophy className="h-3.5 w-3.5" />{l.winners}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-white/5 bg-[#111827] overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-4 border-b border-white/5">
            <Lightbulb className="h-4 w-4 text-purple-400" />
            <h3 className="text-sm font-semibold text-white">Creative Strategists — winners created</h3>
          </div>
          <div className="divide-y divide-white/5">
            {strategists.length === 0 && <p className="px-5 py-6 text-center text-sm text-slate-600">No strategist data yet. Pick a strategist in the uploader or via the Owner button.</p>}
            {strategists.slice(0, 6).map((s) => (
              <div key={s.id} className="flex items-center gap-3 px-5 py-2.5">
                <span className="flex-1 text-sm text-slate-300">{s.name}</span>
                <span className="text-xs text-slate-500">{s.ads} ads</span>
                <span className="text-xs text-slate-500">{s.winRate.toFixed(0)}% hit</span>
                <span className="flex items-center gap-1 text-sm font-semibold text-purple-400"><Trophy className="h-3.5 w-3.5" />{s.winners}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Template Performance */}
      {templates.length > 0 && (
        <div className="rounded-xl border border-white/5 bg-[#111827] overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-4 border-b border-white/5">
            <BarChart3 className="h-4 w-4 text-cyan-400" />
            <h3 className="text-sm font-semibold text-white">Template Performance</h3>
            <span className="text-xs text-slate-600">best → worst (lifetime ROAS on ads with a template)</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/5">
                  {["Template", "Ads", "Winners", "Win rate", "Spend", "ROAS"].map((h, i) => (
                    <th key={h} className={cn("px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider", i > 0 && "text-right")}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {templates.map((t, i) => {
                  const isBest = i === 0 && templates.length > 1 && t.roas > 0;
                  const isWorst = i === templates.length - 1 && templates.length > 1;
                  return (
                    <tr key={t.templateId} className="border-b border-white/5 hover:bg-white/[0.02]">
                      <td className="px-4 py-3 text-sm text-slate-200">
                        {t.templateName}
                        {isBest && <span className="ml-2 text-[10px] text-emerald-400">▲ best</span>}
                        {isWorst && <span className="ml-2 text-[10px] text-red-400">▼ worst</span>}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-slate-400">{t.ads}</td>
                      <td className="px-4 py-3 text-right text-sm text-amber-400">{t.winners}</td>
                      <td className="px-4 py-3 text-right text-sm text-slate-400">{t.winRate.toFixed(0)}%</td>
                      <td className="px-4 py-3 text-right text-sm text-slate-400">${fmt(t.spend)}</td>
                      <td className="px-4 py-3 text-right text-sm font-semibold">
                        <span className={t.roas >= 2.5 ? "text-emerald-400" : t.roas >= 2.0 ? "text-amber-400" : t.roas > 0 ? "text-red-400" : "text-slate-600"}>{t.roas.toFixed(2)}x</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Angle + Problem performance */}
      <div className="grid gap-4 lg:grid-cols-2">
        <PerfTable title="Angle Performance" label="Angle" rows={anglePerf} />
        <PerfTable title="Problem Performance" label="Problem" rows={problemPerf} />
      </div>

      {/* Bonus Tiers (editable) */}
      <div className="rounded-xl border border-white/5 bg-[#111827] p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white">
            Bonus tiers <span className="text-xs font-normal text-slate-500">(locked per ad for life · spend in USD)</span>
          </h3>
          {!editingTiers ? (
            <button onClick={startEditTiers} className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10 transition-all">
              <Pencil className="h-3.5 w-3.5" /> Edit
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button onClick={() => setEditingTiers(false)} className="text-xs px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-400 hover:bg-white/10 transition-all">Cancel</button>
              <button onClick={saveTiers} disabled={savingTiers} className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-cyan-600 text-white hover:bg-cyan-500 transition-all disabled:opacity-50">
                <Check className="h-3.5 w-3.5" /> {savingTiers ? "Saving..." : "Save"}
              </button>
            </div>
          )}
        </div>

        {!editingTiers ? (
          <div className="flex flex-wrap gap-3">
            {tiersSorted.length === 0 && <span className="text-sm text-slate-500">No tiers configured.</span>}
            {tiersSorted.map((t) => (
              <Badge key={t.bonus} variant="outline" className={bonusTierColor(t.bonus)}>
                ${t.bonus} — ${t.minSpend.toLocaleString("en-US")}+ spend, {t.minRoas}+ ROAS
              </Badge>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 text-[10px] uppercase tracking-wider text-slate-500 px-1">
              <span>Bonus ($)</span><span>Min spend ($)</span><span>Min ROAS</span><span></span>
            </div>
            {tierDraft.map((t, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center">
                <input type="number" value={t.bonus} onChange={(e) => updateTier(i, "bonus", parseFloat(e.target.value))} className="rounded-lg bg-white/5 border border-white/10 px-2.5 py-1.5 text-sm text-white [color-scheme:dark]" />
                <input type="number" value={t.minSpend} onChange={(e) => updateTier(i, "minSpend", parseFloat(e.target.value))} className="rounded-lg bg-white/5 border border-white/10 px-2.5 py-1.5 text-sm text-white [color-scheme:dark]" />
                <input type="number" step="0.1" value={t.minRoas} onChange={(e) => updateTier(i, "minRoas", parseFloat(e.target.value))} className="rounded-lg bg-white/5 border border-white/10 px-2.5 py-1.5 text-sm text-white [color-scheme:dark]" />
                <button onClick={() => removeTier(i)} className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all"><X className="h-4 w-4" /></button>
              </div>
            ))}
            <button onClick={addTier} className="flex items-center gap-1.5 text-xs text-cyan-400 hover:text-cyan-300 transition-all mt-1">
              <Plus className="h-3.5 w-3.5" /> Add tier
            </button>
            <p className="text-[11px] text-slate-600 pt-1">
              Changes apply going forward. Already-locked bonuses on existing ads are not lowered automatically.
            </p>
          </div>
        )}
      </div>

      {/* Editor Table */}
      <div className="rounded-xl border border-white/5 bg-[#111827] overflow-hidden">
        <div className="px-5 py-4 border-b border-white/5">
          <h3 className="text-sm font-semibold text-white">Editors</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                {["Editor", "Winners", "Spend", "ROAS", "Hook", "Bonus", "Payout", "Link"].map((h, i) => (
                  <th key={h} className={cn("px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider", i > 0 && "text-right")}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="text-center py-12 text-slate-500">Loading editor data...</td></tr>
              ) : editors.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-12 text-slate-500">No editor data. Assign owners via the uploader or the Owner button in the Ad Set Analyzer.</td></tr>
              ) : (
                editors.map((editor) => (
                  <EditorRow
                    key={editor.editorId}
                    editor={editor}
                    series={seriesByEditor[editor.editorId]}
                    tiers={bonusTiers}
                    onExpand={loadSeries}
                    onCreatePayout={handleCreatePayout}
                    onMarkPaid={handleMarkPaid}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Payout Modal */}
      <Dialog open={showPayoutModal} onOpenChange={setShowPayoutModal}>
        <DialogContent className="w-[92vw] sm:max-w-md bg-[#111827] border-white/10">
          <DialogHeader><DialogTitle className="text-white">Create payout</DialogTitle></DialogHeader>
          {payoutEditor && (
            <div className="space-y-4">
              <div className="rounded-lg bg-white/[0.02] border border-white/5 p-4">
                <div className="flex justify-between mb-2"><span className="text-sm text-slate-400">Editor</span><span className="text-sm font-medium text-white">{payoutEditor.fullName}</span></div>
                <div className="flex justify-between mb-2"><span className="text-sm text-slate-400">Earned (lifetime)</span><span className="text-sm font-medium text-emerald-400">${fmt(payoutEditor.totalBonus)}</span></div>
                <div className="flex justify-between mb-2"><span className="text-sm text-slate-400">Already paid</span><span className="text-sm text-slate-300">${fmt(payoutEditor.paidAmount)}</span></div>
                <div className="flex justify-between pt-2 border-t border-white/5"><span className="text-sm font-medium text-white">To pay now</span><span className="text-lg font-bold text-emerald-400">${fmt(payoutEditor.unpaidAmount)}</span></div>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Ad sets in this payout</p>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {payoutEditor.adsets.filter((s) => s.outstanding > 0).map((s) => (
                    <div key={s.adsetId} className="flex items-center justify-between text-xs py-1">
                      <span className="text-slate-400 truncate max-w-[200px]">{s.adsetName}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-slate-500">${fmt(s.lifetimeSpend, 0)} / {s.lifetimeRoas.toFixed(1)}x</span>
                        <span className="text-emerald-400 font-medium">${s.outstanding}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Note (optional)</label>
                <input value={payoutNotes} onChange={(e) => setPayoutNotes(e.target.value)} placeholder="e.g. Wise, bank transfer..." className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50" />
              </div>
            </div>
          )}
          <DialogFooter>
            <button onClick={() => setShowPayoutModal(false)} className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-slate-300 hover:bg-white/10 transition-all">Cancel</button>
            <button onClick={handleSubmitPayout} disabled={creatingPayout} className="px-4 py-2 rounded-lg bg-gradient-to-r from-emerald-500 to-emerald-600 text-sm font-medium text-white hover:from-emerald-400 hover:to-emerald-500 transition-all disabled:opacity-50">{creatingPayout ? "Creating..." : "Create payout"}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Team Member Modal */}
      <Dialog open={showCreateMember} onOpenChange={setShowCreateMember}>
        <DialogContent className="w-[92vw] sm:max-w-md bg-[#111827] border-white/10">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2"><Users className="h-4 w-4 text-cyan-400" />Manage team</DialogTitle>
            <DialogDescription className="text-slate-400 text-sm">Add a member (a public page /e/name is generated automatically) or remove existing ones below.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={() => setNewMemberType("video_editor")} className={cn("relative rounded-xl border p-4 text-left transition-all", newMemberType === "video_editor" ? "border-cyan-500/50 bg-cyan-500/5 ring-1 ring-cyan-500/30" : "border-white/10 bg-white/[0.02] hover:border-white/20")}>
                <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center mb-2", newMemberType === "video_editor" ? "bg-cyan-500/15" : "bg-white/5")}>
                  <Video className={cn("h-4.5 w-4.5", newMemberType === "video_editor" ? "text-cyan-400" : "text-slate-500")} />
                </div>
                <div className={cn("text-sm font-medium", newMemberType === "video_editor" ? "text-white" : "text-slate-300")}>Video Editor</div>
                <div className="text-[11px] text-slate-500 mt-0.5">Earns bonus</div>
              </button>
              <button type="button" onClick={() => setNewMemberType("creative_strategist")} className={cn("relative rounded-xl border p-4 text-left transition-all", newMemberType === "creative_strategist" ? "border-purple-500/50 bg-purple-500/5 ring-1 ring-purple-500/30" : "border-white/10 bg-white/[0.02] hover:border-white/20")}>
                <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center mb-2", newMemberType === "creative_strategist" ? "bg-purple-500/15" : "bg-white/5")}>
                  <Lightbulb className={cn("h-4.5 w-4.5", newMemberType === "creative_strategist" ? "text-purple-400" : "text-slate-500")} />
                </div>
                <div className={cn("text-sm font-medium", newMemberType === "creative_strategist" ? "text-white" : "text-slate-300")}>Creative Strategist</div>
                <div className="text-[11px] text-slate-500 mt-0.5">Plans concepts (stats)</div>
              </button>
            </div>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Name</label>
                <Input value={newMemberName} onChange={(e) => setNewMemberName(e.target.value)} placeholder="Full name" className="bg-white/5 border-white/10 text-white placeholder:text-slate-600" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Email</label>
                <Input type="email" value={newMemberEmail} onChange={(e) => setNewMemberEmail(e.target.value)} placeholder="name@example.com" className="bg-white/5 border-white/10 text-white placeholder:text-slate-600" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Password</label>
                <div className="relative">
                  <Input type={showPassword ? "text" : "password"} value={newMemberPassword} onChange={(e) => setNewMemberPassword(e.target.value)} placeholder="At least 8 characters" className="bg-white/5 border-white/10 text-white placeholder:text-slate-600 pr-10" />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>
            {createError && (
              <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />{createError}
              </div>
            )}

            {/* Existing team — remove */}
            {allMembers.length > 0 && (
              <div className="pt-3 border-t border-white/5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Team ({allMembers.length}) — click trash to remove</p>
                <div className="space-y-0.5 max-h-48 overflow-y-auto">
                  {allMembers.map((m) => (
                    <div key={m.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/[0.03]">
                      {m.userType === "creative_strategist" ? <Lightbulb className="h-3.5 w-3.5 text-purple-400 shrink-0" /> : <Video className="h-3.5 w-3.5 text-cyan-400 shrink-0" />}
                      <span className="flex-1 truncate text-sm text-slate-300">{m.name}</span>
                      <span className="text-[10px] text-slate-600">{m.userType === "creative_strategist" ? "Strategist" : "Editor"}</span>
                      <button type="button" onClick={() => removeMember(m)} title={`Remove ${m.name}`} className="text-slate-500 hover:text-red-400 transition-colors">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <button onClick={() => setShowCreateMember(false)} className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-slate-300 hover:bg-white/10 transition-all">Cancel</button>
            <button onClick={handleCreateMember} disabled={creatingMember} className={cn("px-4 py-2 rounded-lg text-sm font-medium text-white transition-all disabled:opacity-50", newMemberType === "creative_strategist" ? "bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500" : "bg-gradient-to-r from-cyan-500 to-cyan-600 hover:from-cyan-400 hover:to-cyan-500")}>{creatingMember ? "Creating..." : "Add"}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
