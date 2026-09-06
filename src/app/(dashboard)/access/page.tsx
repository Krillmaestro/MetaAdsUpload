import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { homeFor } from "@/lib/access";
import { AccessManager } from "@/components/access/access-manager";

// Superadmin only: manage people and what each of them may use.
export default async function AccessPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!session.user.isSuperadmin) redirect(homeFor(session.user));
  return <AccessManager currentUserId={session.user.id} />;
}
