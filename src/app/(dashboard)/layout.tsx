import { Sidebar } from "@/components/layout/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { WorkTimerWidget } from "@/components/work/work-timer-widget";
import { auth } from "@/auth";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const userRole = (session?.user?.role || "editor") as "admin" | "editor";
  const isFounder = !!session?.user?.isFounder;

  let editorSlug: string | null = null;
  if (userRole !== "admin" && session?.user?.id) {
    const [user] = await db
      .select({ slug: schema.users.slug })
      .from(schema.users)
      .where(eq(schema.users.id, session.user.id))
      .limit(1);
    editorSlug = user?.slug ?? null;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#0a0e1a] bg-grid-pattern">
      <Sidebar userRole={userRole} editorSlug={editorSlug} isFounder={isFounder} />
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
