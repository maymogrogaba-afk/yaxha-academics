import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarClock, GraduationCap, Plus, RefreshCw, Sparkles } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { getPrefs } from "@/lib/data";
import { ensureDailyPlan, recommendationInput, taskHref } from "@/lib/study/plans";
import { recommend } from "@/lib/study/recommend";
import { daysBetween, dateIn, formatDate, formatDateTime, minutesLabel } from "@/lib/study/dates";
import { Badge, ButtonLink, Card, CardHeader, EmptyState, Field, Input, Notice, ProgressBar, Select } from "@/components/ui";
import { Dialog, SubmitButton } from "@/components/client";
import { ActionForm } from "@/components/action-form";
import { TaskRow } from "@/components/task-row";
import { MaterialIcon } from "@/components/material-icon";
import { addCustomTask, logSession, refreshDailyPlan } from "@/app/actions/tasks";

export const metadata = { title: "Home" };

function greeting(tz: string) {
  const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(new Date()));
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default async function HomePage() {
  const user = await requireUser();
  const data = await withUser(user.id, async (tx) => {
    const prefs = await getPrefs(tx);
    if (!prefs.onboarding_done) return { onboarding: true as const };
    const { today, restDay } = await ensureDailyPlan(tx, user.id);
    const taskSelect = tx`st.*, st.scheduled_date::text as scheduled_date, st.rescheduled_from::text as rescheduled_from, s.display_name as subject_name, t.name as topic_name`;
    const [tasks, missed, exams, assignments, fresh, integration, counts, recInput, minutesToday] = await Promise.all([
      tx`select ${taskSelect} from study_tasks st left join subjects s on s.id = st.subject_id left join topics t on t.id = st.topic_id
         where st.scheduled_date = ${today} order by (st.status = 'done'), st.priority desc, st.created_at`,
      tx`select ${taskSelect} from study_tasks st left join subjects s on s.id = st.subject_id left join topics t on t.id = st.topic_id
         where st.status = 'missed' and st.scheduled_date >= ${today}::date - 7 order by st.scheduled_date desc limit 3`,
      tx`select e.id, e.title, e.exam_at, s.display_name from exams e join subjects s on s.id = e.subject_id
         where e.status = 'upcoming' and e.exam_at > now() order by e.exam_at limit 3`,
      tx`select a.id, a.title, a.due_at, a.subject_id, s.display_name from assignments a join subjects s on s.id = a.subject_id
         where not a.completed and not s.hidden and a.due_at between now() and now() + interval '7 days' order by a.due_at limit 5`,
      tx`select m.id, m.title, m.kind, s.display_name from materials m join subjects s on s.id = m.subject_id
         where m.origin = 'imported' and not m.seen_by_user order by coalesce(m.posted_at, m.created_at) desc limit 5`,
      tx`select status, last_sync_at from integrations where provider = 'google_classroom'`,
      tx`select (select count(*)::int from subjects where not hidden) as subjects,
                (select count(*)::int from study_tasks where status = 'missed' and scheduled_date >= ${today}::date - 7) as missed_week`,
      recommendationInput(tx, prefs.timezone, prefs.session_minutes),
      tx`select coalesce(sum(duration_minutes), 0)::int as m from study_sessions where started_at >= (${today}::date)::timestamp at time zone ${prefs.timezone}`,
    ]);
    return {
      onboarding: false as const,
      prefs,
      today,
      restDay,
      tasks,
      missed,
      exams,
      assignments,
      fresh,
      integration: integration[0] ?? null,
      counts: counts[0],
      recs: recommend(recInput, 3),
      minutesToday: minutesToday[0].m as number,
      subjects: await tx`select id, display_name from subjects where not hidden order by display_name`,
    };
  });
  if (data.onboarding) redirect("/welcome");
  const { prefs, today, tasks, missed, exams, assignments, fresh, integration, counts, recs, minutesToday, restDay } = data;
  const tz = prefs.timezone;
  const pending = tasks.filter((t) => t.status === "pending");
  const plannedMin = tasks.filter((t) => t.status !== "skipped").reduce((s, t) => s + t.duration_minutes, 0);
  const next = pending[0];
  const startHref = next ? taskHref(next as never) : recs[0]?.href ?? "/study";

  return (
    <>
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-faint">{formatDate(today, tz, { weekday: "long", month: "long", day: "numeric" })}</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">
            {greeting(tz)}
            {user.fullName ? `, ${user.fullName.split(" ")[0]}` : ""}.
          </h1>
          <p className="mt-1 text-sm text-muted">
            {next ? (
              <>
                Next: <span className="text-ivory">{next.title}</span> · {minutesLabel(next.duration_minutes)}
              </>
            ) : restDay ? (
              "Today is a rest day in your settings. Rest is part of the plan."
            ) : tasks.length ? (
              "Everything planned for today is done. Nice work."
            ) : (
              "Nothing scheduled yet. Pick something below, or plan an exam."
            )}
          </p>
        </div>
        <ButtonLink href={startHref} variant="primary" className="w-full sm:w-auto">
          <Sparkles className="size-4" /> Start Studying
        </ButtonLink>
      </header>

      {counts.subjects === 0 && (
        <div className="mb-4">
          <Notice
            tone="gold"
            title="Add your subjects to get started"
            action={
              <div className="flex gap-2">
                <ButtonLink href="/classroom" size="sm" variant="primary">
                  Connect Classroom
                </ButtonLink>
                <ButtonLink href="/subjects" size="sm">
                  Add manually
                </ButtonLink>
              </div>
            }
          >
            Import them from Google Classroom, or add them yourself.
          </Notice>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader
              title="Today's plan"
              subtitle={`${minutesLabel(plannedMin)} planned · ${minutesLabel(minutesToday)} logged · daily target ${minutesLabel(prefs.daily_target_minutes)}`}
              action={
                <div className="flex gap-1">
                  <Dialog
                    title="Add a task for today"
                    trigger={
                      <>
                        <Plus className="size-3.5" /> Add
                      </>
                    }
                  >
                    <ActionForm action={addCustomTask} resetOnSuccess>
                      <Field label="What will you do?" htmlFor="ct-title">
                        <Input id="ct-title" name="title" required maxLength={200} placeholder="e.g. Finish problem set 3, items 1–5" />
                      </Field>
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Subject" htmlFor="ct-sub">
                          <Select id="ct-sub" name="subjectId" defaultValue="">
                            <option value="">None</option>
                            {data.subjects.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.display_name}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <Field label="Minutes" htmlFor="ct-min">
                          <Input id="ct-min" name="minutes" type="number" min={5} max={480} defaultValue={prefs.session_minutes} />
                        </Field>
                      </div>
                      <SubmitButton>Add task</SubmitButton>
                    </ActionForm>
                  </Dialog>
                  <form action={refreshDailyPlan}>
                    <SubmitButton size="sm" variant="ghost">
                      <RefreshCw className="size-3.5" />
                      <span className="sr-only sm:not-sr-only">Refresh</span>
                    </SubmitButton>
                  </form>
                </div>
              }
            />
            <div className="px-4 pt-3 sm:px-5">
              <ProgressBar value={plannedMin ? tasks.filter((t) => t.status === "done").reduce((s, t) => s + t.duration_minutes, 0) / plannedMin : 0} label="Today's progress" />
            </div>
            {tasks.length === 0 ? (
              <div className="p-4 sm:p-5">
                <EmptyState title={restDay ? "Rest day" : "No tasks for today"}>
                  {restDay
                    ? "You can still study if you want; add a task or open a subject."
                    : "Suggestions appear here once you have subjects with topics, upcoming exams, due assignments, or flashcards to review."}
                </EmptyState>
              </div>
            ) : (
              <ul className="mt-2 divide-y divide-line">
                {tasks.map((t) => (
                  <TaskRow key={t.id} t={t} />
                ))}
              </ul>
            )}
          </Card>

          {missed.length > 0 && (
            <Card>
              <CardHeader
                title="From earlier this week"
                subtitle={`${counts.missed_week} session${counts.missed_week === 1 ? "" : "s"} didn't happen. That's okay — move what still matters, and let the rest go.`}
              />
              <ul className="divide-y divide-line">
                {missed.map((t) => (
                  <TaskRow key={t.id} t={t} showDate />
                ))}
              </ul>
            </Card>
          )}

          {recs.length > 0 && (
            <Card>
              <CardHeader title="What to study next" subtitle="Ranked from your deadlines, exams, practice results, and review schedule." />
              <ul className="divide-y divide-line">
                {recs.map((r) => (
                  <li key={r.key}>
                    <Link href={r.href} className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-raised/40 sm:px-5">
                      <div className="min-w-0">
                        <div className="text-sm text-ivory">{r.title}</div>
                        <div className="text-xs text-faint">
                          {r.subjectName} · {minutesLabel(r.minutes)}
                        </div>
                        <p className="mt-1 text-xs text-muted">{r.reason}</p>
                      </div>
                      <span className="shrink-0 text-xs text-gold">Start →</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Coming up" action={<ButtonLink href="/exams" size="sm" variant="ghost">Planner</ButtonLink>} />
            {exams.length + assignments.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted">No exams or deadlines in the next 7 days.</p>
            ) : (
              <ul className="divide-y divide-line">
                {exams.map((e) => {
                  const d = daysBetween(today, dateIn(tz, new Date(e.exam_at)));
                  return (
                    <li key={e.id}>
                      <Link href={`/exams/${e.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-raised/40 sm:px-5">
                        <CalendarClock className="size-4 shrink-0 text-gold" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm text-ivory">{e.title}</div>
                          <div className="text-xs text-faint">
                            {e.display_name} · {formatDateTime(e.exam_at, tz)}
                          </div>
                        </div>
                        <Badge tone={d <= 3 ? "gold" : "neutral"}>{d === 0 ? "Today" : d === 1 ? "Tomorrow" : `${d} days`}</Badge>
                      </Link>
                    </li>
                  );
                })}
                {assignments.map((a) => (
                  <li key={a.id}>
                    <Link href={`/subjects/${a.subject_id}?tab=assignments`} className="flex items-center gap-3 px-4 py-3 hover:bg-raised/40 sm:px-5">
                      <span className="size-4 shrink-0 rounded-full border border-line-strong" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-ivory">{a.title}</div>
                        <div className="text-xs text-faint">
                          {a.display_name} · due {formatDateTime(a.due_at, tz)}
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              title="New from Classroom"
              action={
                integration?.last_sync_at ? (
                  <span className="text-[11px] text-faint">synced {formatDateTime(integration.last_sync_at, tz)}</span>
                ) : undefined
              }
            />
            {!integration || integration.status === "not_connected" ? (
              <div className="flex flex-col items-start gap-3 px-4 py-4 sm:px-5">
                <p className="text-sm text-muted">Connect Google Classroom to see new materials here automatically.</p>
                <ButtonLink href="/classroom" size="sm">
                  <GraduationCap className="size-4" /> Connect
                </ButtonLink>
              </div>
            ) : fresh.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted">You&apos;ve seen everything imported so far.</p>
            ) : (
              <ul className="divide-y divide-line">
                {fresh.map((m) => (
                  <li key={m.id}>
                    <Link href={`/materials/${m.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-raised/40 sm:px-5">
                      <MaterialIcon kind={m.kind} className="size-4 shrink-0 text-gold" />
                      <div className="min-w-0">
                        <div className="truncate text-sm text-ivory">{m.title}</div>
                        <div className="text-xs text-faint">{m.display_name}</div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-4 sm:p-5">
            <h2 className="text-sm font-semibold">Log study time</h2>
            <p className="mt-1 text-xs text-muted">Studied offline? Record it so your progress stays accurate.</p>
            <ActionForm action={logSession} resetOnSuccess className="mt-3 flex flex-col gap-2">
              <div className="grid grid-cols-[1fr_90px] gap-2">
                <Select name="subjectId" defaultValue="" aria-label="Subject">
                  <option value="">No specific subject</option>
                  {data.subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.display_name}
                    </option>
                  ))}
                </Select>
                <Input name="minutes" type="number" min={1} max={600} placeholder="min" aria-label="Minutes" required />
              </div>
              <SubmitButton size="sm" variant="secondary">
                Log time
              </SubmitButton>
            </ActionForm>
          </Card>
        </div>
      </div>
    </>
  );
}
