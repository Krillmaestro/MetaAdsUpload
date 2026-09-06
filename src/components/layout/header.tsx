"use client";

import { usePathname } from "next/navigation";

const pageTitles: Record<string, string> = {
  "/dashboard": "Premium MetaAds Dashboard",
  "/upload": "Upload Ads",
  "/templates": "Templates",
  "/creatives": "Creative Library",
  "/campaigns": "Campaigns",
  "/assignments": "Assignments",
  "/my-work": "My Work",
  "/timer": "Timer",
  "/options": "Options",
  "/editors": "Editor Performance",
  "/scorecards": "Editor Scorecards",
  "/settings": "Settings",
  "/access": "Access",
};

export function Header() {
  const pathname = usePathname();
  const title = pageTitles[pathname] || "MetaAds";

  return (
    <header className="flex h-14 items-center px-6 border-b border-white/5 bg-transparent">
      <h1 className="text-lg font-semibold text-white">{title}</h1>
    </header>
  );
}
