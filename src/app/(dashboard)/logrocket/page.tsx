import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { LogRocketDashboard } from "@/components/insights/logrocket-dashboard";
import { loadDashboard } from "@/lib/logrocket-store";

export const dynamic = "force-dynamic";
export const metadata = { title: "LogRocket · SmallDogCO" };

export default async function LogRocketPage() {
  const session = await auth();

  if (!session?.user) redirect("/login");
  if (!session.user.isFounder) {
    redirect(session.user.role === "admin" ? "/dashboard" : "/my-work");
  }

  const { versions, current, previous } = await loadDashboard();

  return <LogRocketDashboard versions={versions} initialCurrent={current} initialPrevious={previous} />;
}
