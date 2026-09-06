import { Sidebar } from "@/components/layout/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { WorkTimerWidget } from "@/components/work/work-timer-widget";
import { auth } from "@/auth";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { allowedAreas, homeFor } from "@/lib/access";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const user = session?.user ?? null;
  const areas = [...allowedAreas(user)];
  const isFounder = !!user?.isFounder;

  let editorSlug: string | null = null;
  if (user?.id) {
    const [row] = await db
      .select({ slug: schema.users.slug })
      .from(schema.users)
      .where(eq(schema.users.id, user.id))
      .limit(1);
    editorSlug = user.role !== "admin" ? row?.slug ?? null : null;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#0a0e1a] bg-grid-pattern">
      <Sidebar areas={areas} editorSlug={editorSlug} home={homeFor(user)} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <main className="flex-1 overflow-auto p-4 md:p-6">
          <div className="max-w-[1800px]">{children}</div>
        </main>
      </div>
      {/* Founders can start/stop the timer from any page in the app. */}
      {isFounder && <WorkTimerWidget />}
      <Toaster />
    </div>
  );
}
