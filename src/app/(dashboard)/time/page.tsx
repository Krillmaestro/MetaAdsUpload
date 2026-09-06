import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { TimeDashboard } from "@/components/work/time-dashboard";
import { homeFor } from "@/lib/access";

export const dynamic = "force-dynamic";

export default async function TimePage() {
  const session = await auth();

  if (!session?.user) redirect("/login");
  if (!session.user.isFounder) {
    redirect(homeFor(session.user));
  }

  return <TimeDashboard currentUserId={session.user.id} />;
}
