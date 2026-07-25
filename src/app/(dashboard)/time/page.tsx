import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { TimeDashboard } from "@/components/work/time-dashboard";

export const dynamic = "force-dynamic";

export default async function TimePage() {
  const session = await auth();

  if (!session?.user) redirect("/login");
  if (!session.user.isFounder) {
    redirect(session.user.role === "admin" ? "/dashboard" : "/my-work");
  }

  return <TimeDashboard currentUserId={session.user.id} />;
}
