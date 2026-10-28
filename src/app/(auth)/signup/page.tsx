import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Card } from "@/components/ui";
import { SignUpForm } from "@/components/auth-forms";

export const metadata = { title: "Create account" };

export default async function SignUpPage() {
  if (await getCurrentUser()) redirect("/home");
  return (
    <Card className="p-6">
      <h1 className="mb-1 text-lg font-semibold">Create your account</h1>
      <p className="mb-6 text-sm text-muted">Your subjects, materials, and progress are saved to your account.</p>
      <SignUpForm />
    </Card>
  );
}
