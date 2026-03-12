"use client";

import { usePathname } from "next/navigation";

const pageTitles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/upload": "Upload Ads",
  "/templates": "Templates",
  "/creatives": "Creative Library",
  "/campaigns": "Campaigns",
  "/rules": "Automation Rules",
};

export function Header() {
  const pathname = usePathname();
  const title = pageTitles[pathname] || "MetaAdsUpload";

  return (
    <header className="flex h-14 items-center border-b px-6">
      <h1 className="text-lg font-semibold">{title}</h1>
    </header>
  );
}
