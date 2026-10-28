import Link from "next/link";
import { Download } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { sql, withUser } from "@/lib/db";
import { env, googleConfigured } from "@/lib/env";
import { getPrefs } from "@/lib/data";
import { aiAvailable, currentModel } from "@/lib/ai/provider";
import { Badge, Card, CardHeader, Field, Input, PageHeader, buttonClass } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { ActionForm } from "@/components/action-form";
import { PreferencesForm } from "@/components/preferences-form";
import { changePassword, deleteAccount, saveProfile, signOutOtherDevices } from "@/app/actions/settings";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser();
  const data = await withUser(user.id, async (tx) => ({
    prefs: await getPrefs(tx),
    profile: (await tx`select * from profiles`)[0] ?? { full_name: user.fullName, school: "", program: "", year_level: "" },
    usage: (await tx`select count(*)::int as n, coalesce(sum(input_tokens),0)::int as input, coalesce(sum(output_tokens),0)::int as output,
                     count(*) filter (where not ok)::int as failed from ai_usage where created_at > now() - interval '30 days'`)[0],
    integration: (await tx`select status, account_email from integrations where provider = 'google_classroom'`)[0],
  }));
  const [{ n: deviceCount }] = await sql`select count(*)::int as n from sessions where user_id = ${user.id} and expires_at > now()`;
  const ai = aiAvailable();

  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Profile" subtitle={user.email} />
          <div className="p-4 sm:p-5">
            <ActionForm action={saveProfile}>
              <Field label="Name" htmlFor="pf-name">
                <Input id="pf-name" name="fullName" defaultValue={data.profile.full_name} required maxLength={120} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="School" htmlFor="pf-school">
                  <Input id="pf-school" name="school" defaultValue={data.profile.school} maxLength={160} />
                </Field>
                <Field label="Program" htmlFor="pf-prog">
                  <Input id="pf-prog" name="program" defaultValue={data.profile.program} maxLength={160} />
                </Field>
                <Field label="Year level" htmlFor="pf-year">
                  <Input id="pf-year" name="yearLevel" defaultValue={data.profile.year_level} maxLength={40} />
                </Field>
              </div>
              <div>
                <SubmitButton variant="secondary">Save profile</SubmitButton>
              </div>
            </ActionForm>
          </div>
        </Card>

        <Card>
          <CardHeader title="Study preferences" subtitle="Used for daily plans and exam schedules." />
          <div className="p-4 sm:p-5">
            <PreferencesForm prefs={data.prefs} />
          </div>
        </Card>

        <Card>
          <CardHeader title="AI provider" subtitle="Configured on the server; keys are never sent to your browser." />
          <div className="space-y-3 p-4 text-sm sm:p-5">
            <div className="flex flex-wrap items-center gap-2">
              {ai ? <Badge tone="ok">Configured</Badge> : <Badge tone="warn">Not configured</Badge>}
              <span className="text-muted">
                Provider: <span className="text-ivory">{env.ai.provider}</span>
                {ai && (
                  <>
                    {" "}
                    · Model: <span className="text-ivory">{currentModel() || "—"}</span>
                  </>
                )}
              </span>
            </div>
            <p className="text-muted">
              Last 30 days: {data.usage.n} requests ({data.usage.failed} failed), {data.usage.input.toLocaleString()} input and {data.usage.output.toLocaleString()} output tokens. Limit:{" "}
              {env.ai.maxRequestsPerHour} requests per hour.
            </p>
            {!ai && <p className="text-xs text-faint">To enable AI features, set AI_API_KEY (and optionally AI_PROVIDER and AI_MODEL) in the server environment. See the README.</p>}
            <p className="text-xs text-faint">AI providers charge per token. Check your provider&apos;s pricing page; the token counts above help you estimate cost.</p>
          </div>
        </Card>

        <Card>
          <CardHeader title="Google Classroom" />
          <div className="space-y-3 p-4 text-sm sm:p-5">
            <p className="text-muted">
              {!googleConfigured()
                ? "Not set up on this server yet."
                : data.integration && data.integration.status !== "not_connected"
                  ? `Connected as ${data.integration.account_email ?? "your Google account"}.`
                  : "Not connected."}
            </p>
            <Link href="/classroom" className={buttonClass("secondary", "sm")}>
              Manage connection
            </Link>
          </div>
        </Card>

        <Card>
          <CardHeader title="Security" />
          <div className="space-y-4 p-4 sm:p-5">
            <ActionForm action={changePassword} resetOnSuccess>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Current password" htmlFor="cp-cur">
                  <Input id="cp-cur" name="current" type="password" autoComplete="current-password" required />
                </Field>
                <Field label="New password" htmlFor="cp-new">
                  <Input id="cp-new" name="next" type="password" autoComplete="new-password" minLength={10} required />
                </Field>
              </div>
              <div>
                <SubmitButton variant="secondary">Change password</SubmitButton>
              </div>
            </ActionForm>
            <form action={signOutOtherDevices} className="flex items-center justify-between gap-3 border-t border-line pt-4 text-sm">
              <span className="text-muted">Signed in on {deviceCount} device{deviceCount === 1 ? "" : "s"}.</span>
              <SubmitButton size="sm" variant="ghost">
                Sign out other devices
              </SubmitButton>
            </form>
          </div>
        </Card>

        <Card>
          <CardHeader title="Your data and privacy" />
          <div className="space-y-4 p-4 text-sm sm:p-5">
            <p className="text-muted">
              Your study data is stored in this app&apos;s database and is visible only to your account. Google sign-in tokens are encrypted. When you use AI features, the
              selected material text and your messages are sent to the AI provider to generate a response.
            </p>
            <a href="/api/export" className={buttonClass("secondary", "sm")}>
              <Download className="size-4" /> Export all my data (JSON)
            </a>
            <details className="rounded-lg border border-bad/30 p-3">
              <summary className="cursor-pointer text-bad">Delete my account</summary>
              <p className="mt-2 text-muted">This permanently deletes your account, subjects, materials, summaries, quizzes, flashcards, plans, and history. It cannot be undone. Export first if you want a copy.</p>
              <ActionForm action={deleteAccount} className="mt-3 flex flex-col gap-3">
                <Field label="Password" htmlFor="da-pw">
                  <Input id="da-pw" name="password" type="password" autoComplete="current-password" required />
                </Field>
                <Field label='Type "DELETE" to confirm' htmlFor="da-c">
                  <Input id="da-c" name="confirm" required />
                </Field>
                <div>
                  <SubmitButton variant="danger">Delete account permanently</SubmitButton>
                </div>
              </ActionForm>
            </details>
          </div>
        </Card>
      </div>
    </>
  );
}
