import { GraduationCap, PenLine } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { getPrefs, listSubjects } from "@/lib/data";
import { googleConfigured } from "@/lib/env";
import { Badge, Card, Field, Input, PageHeader, buttonClass } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { ActionForm } from "@/components/action-form";
import { PreferencesForm } from "@/components/preferences-form";
import { skipOnboarding } from "@/app/actions/settings";
import { createSubjectInline } from "@/app/actions/onboarding";

export const metadata = { title: "Welcome" };

export default async function WelcomePage() {
  const user = await requireUser();
  const { prefs, subjects, integration } = await withUser(user.id, async (tx) => ({
    prefs: await getPrefs(tx),
    subjects: await listSubjects(tx),
    integration: (await tx`select status from integrations where provider = 'google_classroom'`)[0],
  }));
  const connected = integration && integration.status !== "not_connected";
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow="Welcome" title={`Let's set up your study space${user.fullName ? `, ${user.fullName.split(" ")[0]}` : ""}`} description="Two quick steps. You can change everything later in Settings." />
      <div className="flex flex-col gap-4">
        <Card className="p-5">
          <div className="flex items-start gap-3">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-gold/50 text-xs text-gold">1</span>
            <div className="flex-1">
              <h2 className="font-medium">Bring in your subjects</h2>
              <p className="mt-1 text-sm text-muted">Connect Google Classroom to import your classes and their materials, or add subjects yourself.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {connected ? (
                  <Badge tone="ok">Google Classroom connected</Badge>
                ) : (
                  <a href={googleConfigured() ? "/api/google/connect?drive=1" : "/classroom"} className={buttonClass("primary")}>
                    <GraduationCap className="size-4" /> Connect Google Classroom
                  </a>
                )}
              </div>
              {!googleConfigured() && <p className="mt-2 text-xs text-warn">Google sign-in isn&apos;t configured on this server yet, so add subjects manually for now.</p>}
              <div className="mt-5 border-t border-line pt-4">
                <div className="mb-2 flex items-center gap-2 text-sm text-muted">
                  <PenLine className="size-4" /> Or add a subject
                </div>
                <ActionForm action={createSubjectInline} resetOnSuccess className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <div className="flex-1">
                    <Field label="Subject name" htmlFor="w-subject">
                      <Input id="w-subject" name="name" placeholder="e.g. Differential Equations" required maxLength={200} />
                    </Field>
                  </div>
                  <SubmitButton variant="secondary">Add</SubmitButton>
                </ActionForm>
                {subjects.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {subjects.map((s) => (
                      <Badge key={s.id} tone="gold">
                        {s.display_name}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-start gap-3">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-gold/50 text-xs text-gold">2</span>
            <div className="flex-1">
              <h2 className="font-medium">Your study rhythm</h2>
              <p className="mb-4 mt-1 text-sm text-muted">Daily plans are built to fit this, so they stay realistic.</p>
              <PreferencesForm prefs={prefs} onboarding />
            </div>
          </div>
        </Card>
        <form action={skipOnboarding} className="text-center">
          <button className="text-sm text-faint hover:text-ivory">Skip for now</button>
        </form>
      </div>
    </div>
  );
}
