import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Card } from "@/components/ui";
import { SignInForm } from "@/components/auth-forms";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/home");
  return (
    <Card className="p-6">
      <h1 className="mb-1 text-lg font-semibold">Welcome back</h1>
      <p className="mb-6 text-sm text-muted">Sign in to continue studying.</p>
      <SignInForm />
    </Card>
  );
}
