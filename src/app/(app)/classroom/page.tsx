import { CircleCheck, ExternalLink, GraduationCap, Lock } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { googleConfigured } from "@/lib/env";
import { getPrefs } from "@/lib/data";
import { SCOPE_EXPLANATIONS, hasDriveScope, redirectUri } from "@/lib/google/oauth";
import { formatDateTime } from "@/lib/study/dates";
import { Badge, Card, CardHeader, Notice, PageHeader, buttonClass } from "@/components/ui";
import { Dialog, SubmitButton } from "@/components/client";
import { ActionForm } from "@/components/action-form";
import { disconnectAction, syncNow } from "@/app/actions/classroom";

export const metadata = { title: "Google Classroom" };
export const maxDuration = 300;

const STATUS: Record<string, { label: string; tone: "neutral" | "ok" | "warn" | "bad" | "info" | "gold" }> = {
  not_connected: { label: "Not connected", tone: "neutral" },
  authorization_required: { label: "Authorization required", tone: "warn" },
  connected: { label: "Connected", tone: "ok" },
  syncing: { label: "Synchronizing", tone: "info" },
  synced: { label: "Synchronized", tone: "ok" },
  partial: { label: "Partially imported", tone: "warn" },
  permission_required: { label: "Permission required", tone: "warn" },
  failed: { label: "Synchronization failed", tone: "bad" },
};

export default async function ClassroomPage({ searchParams }: { searchParams: Promise<{ error?: string; connected?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const data = await withUser(user.id, async (tx) => ({
    prefs: await getPrefs(tx),
    integration: (await tx`select * from integrations where provider = 'google_classroom'`)[0] ?? null,
    runs: await tx`select * from sync_runs order by started_at desc limit 5`,
    subjects: await tx`select count(*)::int as n from subjects where source_provider = 'google_classroom'`,
  }));
  const configured = googleConfigured();
  const i = data.integration;
  // A sync that never finished (e.g. the server restarted) should not show as "syncing" forever.
  const stuck = i?.status === "syncing" && data.runs[0] && !data.runs[0].finished_at && Date.now() - new Date(data.runs[0].started_at).getTime() > 10 * 60_000;
  const status = !i ? "not_connected" : stuck ? "failed" : i.status;
  const connected = i && !["not_connected"].includes(status);
  const drive = hasDriveScope(i?.granted_scopes);
  const tz = data.prefs.timezone;
  const s = STATUS[status] ?? STATUS.not_connected;

  return (
    <>
      <PageHeader
        title="Google Classroom"
        description="Your Classroom courses become subjects automatically, and their posted materials appear in each subject's library."
      />
      {sp.error && (
        <div className="mb-4">
          <Notice tone="bad" title="Google Classroom was not connected">
            {sp.error}
          </Notice>
        </div>
      )}
      {sp.connected && (
        <div className="mb-4">
          <Notice tone={sp.connected === "partial" ? "warn" : "ok"} title={sp.connected === "partial" ? "Connected with limited permissions" : "Connected to Google"}>
            {sp.connected === "partial" ? "Some permissions were not granted, so parts of Classroom can't be imported. You can reconnect and allow them." : "Now run Sync Now to import your courses."}
          </Notice>
        </div>
      )}
      {!configured && (
        <div className="mb-4">
          <Notice tone="warn" title="Setup required on the server">
            Google sign-in needs a Google Cloud OAuth client. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and TOKEN_ENCRYPTION_KEY to the server environment, with this redirect URI:
            <code className="mt-1 block break-all rounded bg-raised px-2 py-1 text-xs text-ivory">{redirectUri()}</code>
            The README has step-by-step instructions. Until then, you can add subjects and upload materials yourself.
          </Notice>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <Card className="p-5">
            <div className="flex items-start gap-4">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-line bg-raised">
                <GraduationCap className="size-5 text-gold" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-medium">Status</h2>
                  <Badge tone={s.tone}>{s.label}</Badge>
                  {drive && <Badge tone="info">Drive files allowed</Badge>}
                </div>
                <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-faint">Google account</dt>
                    <dd className="text-ivory">{i?.account_email ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-faint">Last successful sync</dt>
                    <dd className="text-ivory">{i?.last_sync_at ? formatDateTime(i.last_sync_at, tz) : "Never"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-faint">Imported subjects</dt>
                    <dd className="text-ivory">{data.subjects[0].n}</dd>
                  </div>
                </dl>
                {i?.last_error && <p className="mt-3 text-sm text-warn">{i.last_error}</p>}
                {status === "permission_required" && !drive && connected && (
                  <p className="mt-3 text-sm text-muted">Drive access was not granted, so attached files are listed but can&apos;t be opened or summarised. Reconnect and allow Drive to fix this.</p>
                )}
              </div>
            </div>
            <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
              {connected && status !== "authorization_required" ? (
                <>
                  <ActionForm action={syncNow} className="flex flex-col gap-2">
                    <div>
                      <SubmitButton pendingText="Synchronizing… this can take a minute">Sync Now</SubmitButton>
                    </div>
                  </ActionForm>
                  {!drive && (
                    <a href="/api/google/connect?drive=1" className={buttonClass("secondary")}>
                      Allow Drive files
                    </a>
                  )}
                </>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap gap-2">
                    <a
                      href={configured ? "/api/google/connect?drive=1" : undefined}
                      aria-disabled={!configured}
                      className={buttonClass("primary", "md", !configured ? "pointer-events-none opacity-50" : undefined)}
                    >
                      {status === "authorization_required" ? "Reconnect Google Classroom" : "Connect Google Classroom"}
                    </a>
                    <a href={configured ? "/api/google/connect?drive=0" : undefined} aria-disabled={!configured} className={buttonClass("ghost", "md", !configured ? "pointer-events-none opacity-50" : undefined)}>
                      Connect without Drive files
                    </a>
                  </div>
                  <p className="flex items-center gap-1.5 text-xs text-faint">
                    <Lock className="size-3.5" /> You sign in on Google&apos;s own page. Access is read-only and can be revoked any time.
                  </p>
                </div>
              )}
              {connected && (
                <Dialog title="Disconnect Google Classroom" trigger="Disconnect" triggerClassName={buttonClass("ghost", "md", "ml-auto")}>
                  <form action={disconnectAction} className="flex flex-col gap-4 text-sm">
                    <p className="text-muted">
                      Yaxha will revoke its Google access and delete the stored sign-in tokens. Your subjects (with your custom names), summaries, quizzes, flashcards, notes, exam plans,
                      and progress are always kept.
                    </p>
                    <label className="flex items-start gap-2">
                      <input type="checkbox" name="removeImported" className="mt-1 accent-[#D6B36A]" />
                      <span>
                        Also remove imported Classroom materials from my library
                        <span className="block text-xs text-faint">Your own uploads and notes stay. Study packs made from removed files are kept.</span>
                      </span>
                    </label>
                    <SubmitButton variant="danger">Disconnect</SubmitButton>
                  </form>
                </Dialog>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Recent synchronizations" />
            {data.runs.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted">No syncs yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {data.runs.map((r) => (
                  <li key={r.id} className="px-4 py-3 text-sm sm:px-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-ivory">{formatDateTime(r.started_at, tz)}</span>
                      <Badge tone={r.status === "succeeded" ? "ok" : r.status === "partial" ? "warn" : r.status === "failed" ? "bad" : "info"}>
                        {r.status === "running" && !r.finished_at ? "Running / interrupted" : r.status}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-faint">
                      {r.courses_found} courses · {r.subjects_created} new subjects · {r.items_imported} new items · {r.items_updated} updated
                    </p>
                    {(r.issues as { course?: string; item?: string; message: string }[]).length > 0 && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs text-warn">{(r.issues as unknown[]).length} issue(s)</summary>
                        <ul className="mt-1 space-y-1 text-xs text-muted">
                          {(r.issues as { course?: string; item?: string; message: string }[]).map((x, k) => (
                            <li key={k}>
                              {x.course && <span className="text-ivory">{x.course}: </span>}
                              {x.item && <span>{x.item} — </span>}
                              {x.message}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card className="p-5">
            <h2 className="text-sm font-semibold">What Yaxha asks Google for</h2>
            <ul className="mt-3 space-y-2.5 text-sm">
              {SCOPE_EXPLANATIONS.map((x) => (
                <li key={x.scope} className="flex gap-2">
                  <CircleCheck className="mt-0.5 size-4 shrink-0 text-gold" />
                  <span>
                    <span className="block font-mono text-xs text-faint">{x.scope}</span>
                    <span className="text-muted">{x.why}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
          <Card className="p-5 text-sm text-muted">
            <h2 className="mb-2 text-sm font-semibold text-ivory">Good to know</h2>
            <ul className="list-disc space-y-1.5 pl-4">
              <li>Sync runs when you press Sync Now. It is not real-time.</li>
              <li>Matching uses Google&apos;s course ids, so syncing again never duplicates subjects and your renamed subjects keep their names.</li>
              <li>If a class disappears from Classroom, its subject and all your study content stay, marked as no longer available.</li>
              <li>Some files may be blocked by their owner&apos;s sharing settings. They are listed with an “Open in Google” link and an option to upload a copy.</li>
              <li>Yaxha does not submit assignments for you.</li>
            </ul>
            <a href="https://classroom.google.com" target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1 text-gold hover:underline">
              Open Google Classroom <ExternalLink className="size-3.5" />
            </a>
          </Card>
        </div>
      </div>
    </>
  );
}
