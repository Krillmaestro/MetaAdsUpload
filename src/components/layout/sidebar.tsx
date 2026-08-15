"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Upload,
  FileText,
  Image,
  Megaphone,
  Zap,
  Settings,
  LogOut,
  Users,
  LayoutGrid,
  ClipboardList,
  ListTodo,
  Timer,
  SlidersHorizontal,
  Target,
  DollarSign,
  Menu,
  X,
  Eye,
  History,
  BarChart3,
  ClipboardCheck,
  Sun,
  Users2,
  Route,
  TrendingUp,
  ScrollText,
  ShoppingBag,
  Rocket,
  Hourglass,
  MousePointerClick,
} from "lucide-react";
import { signOut } from "next-auth/react";

type NavSection = {
  label: string;
  requiredRole?: "admin";
  items: { href: string; label: string; icon: React.ComponentType<{ className?: string }> }[];
};

// Founder-only pages — the co-founder may not hold an admin role.
const founderSection: NavSection = {
  label: "FOUNDERS",
  items: [
    { href: "/time", label: "Time Tracker", icon: Hourglass },
    { href: "/logrocket", label: "LogRocket", icon: MousePointerClick },
  ],
};

// Video editors get a minimal menu: their workflow + their own public page.
function editorNavSections(editorSlug?: string | null, isFounder?: boolean): NavSection[] {
  return [
    {
      label: "WORKFLOW",
      items: [
        { href: "/my-work", label: "My Work", icon: ClipboardList },
        { href: "/timer", label: "Timer", icon: Timer },
      ],
    },
    ...(isFounder ? [founderSection] : []),
    ...(editorSlug
      ? [{
          label: "MY PAGE",
          items: [{ href: `/e/${editorSlug}`, label: "My Editor Page", icon: TrendingUp }],
        }]
      : []),
  ];
}

const navSections: NavSection[] = [
  {
    label: "OVERVIEW",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    ],
  },
  {
    label: "MANAGE",
    items: [
      { href: "/upload", label: "Upload", icon: Upload },
      { href: "/upload/native", label: "Native Ad", icon: Rocket },
      { href: "/upload-log", label: "Upload Log", icon: History },
      { href: "/templates", label: "Templates", icon: FileText },
      { href: "/creatives", label: "Creatives", icon: Image },
      { href: "/campaigns", label: "Campaigns", icon: Megaphone },
      { href: "/scaling", label: "Scaling", icon: Target },
    ],
  },
  {
    label: "EVOLVE",
    items: [
      { href: "/daily-summary", label: "Daily Summary", icon: Sun },
      { href: "/adset-analyzer", label: "Ad Set Analyzer", icon: BarChart3 },
      { href: "/ad-analyzer", label: "Creative Analyzer", icon: Eye },
      { href: "/audit", label: "Audit", icon: ClipboardCheck },
      { href: "/evolve-settings", label: "KPI Settings", icon: SlidersHorizontal },
    ],
  },
  {
    label: "STRATEGY",
    requiredRole: "admin",
    items: [
      { href: "/strategy/avatars", label: "Avatar Library", icon: Users2 },
      { href: "/strategy/roadmap", label: "Creative Roadmap", icon: Route },
      { href: "/strategy/hit-rate", label: "Hit Rate", icon: TrendingUp },
      { href: "/strategy/log", label: "Activity Log", icon: ScrollText },
    ],
  },
  {
    label: "WORKFLOW",
    items: [
      { href: "/assignments", label: "Assignments", icon: LayoutGrid },
      { href: "/my-work", label: "My Work", icon: ClipboardList },
      { href: "/review", label: "Review", icon: Eye },
      { href: "/timer", label: "Timer", icon: Timer },
      { href: "/tasks", label: "Team Tasks", icon: ListTodo },
    ],
  },
  {
    label: "ADMIN",
    requiredRole: "admin",
    items: [
      { href: "/shopify", label: "Shopify ncROAS", icon: ShoppingBag },
      { href: "/options", label: "Options", icon: SlidersHorizontal },
      { href: "/editors", label: "Editors", icon: Users },
      { href: "/scorecards", label: "Scorecards", icon: Users },
      { href: "/trueprofit", label: "TrueProfit", icon: DollarSign },
      { href: "/rules", label: "Rules", icon: Zap },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

function SidebarContent({ onNavClick, userRole, editorSlug, isFounder }: { onNavClick?: () => void; userRole: "admin" | "editor"; editorSlug?: string | null; isFounder?: boolean }) {
  const pathname = usePathname();

  const filteredSections =
    userRole === "admin"
      ? [
          ...navSections.filter((s) => !s.requiredRole || s.requiredRole === userRole),
          ...(isFounder ? [founderSection] : []),
        ]
      : editorNavSections(editorSlug, isFounder);

  return (
    <>
      {/* Logo */}
      <div className="flex h-16 items-center px-5 gap-2.5 shrink-0">
        <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-cyan-400 to-cyan-600 flex items-center justify-center">
          <Megaphone className="h-4 w-4 text-white" />
        </div>
        <Link
          href={userRole === "admin" ? "/dashboard" : "/my-work"}
          className="font-bold text-base text-white tracking-tight"
          onClick={onNavClick}
        >
          MetaAds
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-4 overflow-auto">
        {filteredSections.map((section) => (
          <div key={section.label}>
            <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              {section.label}
            </div>
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavClick}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-200",
                      isActive
                        ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                        : "text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent"
                    )}
                  >
                    <item.icon
                      className={cn(
                        "h-4 w-4 flex-shrink-0",
                        isActive && "text-cyan-400"
                      )}
                    />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Sign Out */}
      <div className="p-3 border-t border-white/5 shrink-0">
        <button
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-all w-full"
          onClick={() => signOut({ callbackUrl: "/login" })}
        >
          <LogOut className="h-4 w-4" />
          Sign Out
        </button>
      </div>
    </>
  );
}

export function Sidebar({ userRole = "editor", editorSlug, isFounder }: { userRole?: "admin" | "editor"; editorSlug?: string | null; isFounder?: boolean }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Desktop sidebar — always visible at md+ */}
      <div className="hidden md:flex h-screen w-56 flex-col bg-[#0f1629] border-r border-white/5 shrink-0">
        <SidebarContent userRole={userRole} editorSlug={editorSlug} isFounder={isFounder} />
      </div>

      {/* Mobile drawer backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile drawer sidebar */}
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-56 flex-col bg-[#0f1629] border-r border-white/5 transition-transform duration-300 ease-in-out md:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Close button inside drawer */}
        <button
          className="absolute top-4 right-3 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          onClick={() => setMobileOpen(false)}
          aria-label="Close sidebar"
        >
          <X className="h-5 w-5" />
        </button>

        <SidebarContent onNavClick={() => setMobileOpen(false)} userRole={userRole} editorSlug={editorSlug} isFounder={isFounder} />
      </div>

      {/* Mobile top bar */}
      <MobileHeader onMenuClick={() => setMobileOpen(true)} />
    </>
  );
}

export function MobileHeader({
  onMenuClick,
}: {
  onMenuClick?: () => void;
}) {
  return (
    <div className="flex md:hidden items-center h-14 px-4 gap-3 bg-[#0f1629] border-b border-white/5 shrink-0">
      <button
        className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
        onClick={onMenuClick}
        aria-label="Open sidebar"
      >
        <Menu className="h-5 w-5" />
      </button>
      <div className="flex items-center gap-2">
        <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-cyan-400 to-cyan-600 flex items-center justify-center">
          <Megaphone className="h-3.5 w-3.5 text-white" />
        </div>
        <span className="font-bold text-sm text-white tracking-tight">
          MetaAds
        </span>
      </div>
    </div>
  );
}
