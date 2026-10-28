import { redirect } from "next/navigation";
import { getCurrentUser, signOut } from "@/lib/auth";
import { MobileNav, Sidebar } from "@/components/nav";

async function signOutAction() {
  "use server";
  await signOut();
  redirect("/login");
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return (
    <div className="flex min-h-dvh">
      <Sidebar userName={user.fullName || user.email} signOut={signOutAction} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileNav signOut={signOutAction} />
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-5 sm:px-6 lg:px-10 lg:pb-12 lg:pt-8">
          {children}
        </main>
      </div>
    </div>
  );
}
