import Link from "next/link";
import { notFound } from "next/navigation";
import { RefreshCw, Trash2 } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { getPrefs, isUuid } from "@/lib/data";
import { readiness } from "@/lib/study/readiness";
import { daysBetween, formatDate, formatDateTime, minutesLabel, toLocalInput, todayIn, dateIn } from "@/lib/study/dates";
import { Badge, Button, ButtonLink, Card, CardHeader, Field, Input, Notice, PageHeader, ProgressBar, Select } from "@/components/ui";
import { Dialog, SubmitButton } from "@/components/client";
import { ActionForm } from "@/components/action-form";
import { TaskRow } from "@/components/task-row";
import { addExamTopics, deleteExam, regeneratePlanAction, removeExamTopic, setExamStatus, setExamTopic, updateExam } from "@/app/actions/exams";

export const metadata = { title: "Exam plan" };

export default async function ExamPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const data = await withUser(user.id, async (tx) => {
    const [exam] = await tx`select e.*, s.display_name as subject_name from exams e join subjects s on s.id = e.subject_id where e.id = ${id}`;
    if (!exam) return null;
    const prefs = await getPrefs(tx);
    return {
      exam,
      prefs,
      topics: await tx`
        select t.id, t.name, t.importance, et.difficulty, et.confidence, m.attempts, m.recent_accuracy, m.last_practiced_at, m.mistake_counts
        from exam_topics et join topics t on t.id = et.topic_id left join topic_mastery m on m.topic_id = t.id
        where et.exam_id = ${id} order by t.name`,
      otherTopics: await tx`select id, name from topics where subject_id = ${exam.subject_id}
        and id not in (select topic_id from exam_topics where exam_id = ${id}) order by name`,
      tasks: await tx`
        select st.*, st.scheduled_date::text as scheduled_date, st.rescheduled_from::text as rescheduled_from, s.display_name as subject_name, t.name as topic_name
        from study_tasks st left join subjects s on s.id = st.subject_id left join topics t on t.id = st.topic_id
        where st.exam_id = ${id} order by st.scheduled_date, st.priority desc`,
      plan: (await tx`select warnings, generated_at from study_plans where exam_id = ${id} order by generated_at desc limit 1`)[0],
    };
  });
  if (!data) notFound();
  const { exam, prefs, topics, otherTopics, tasks, plan } = data;
  const tz = prefs.timezone;
  const today = todayIn(tz);
  const examDate = dateIn(tz, new Date(exam.exam_at));
  const daysLeft = daysBetween(today, examDate);
  const r = readiness(
    topics.map((t) => ({
      name: t.name,
      attempts: t.attempts ?? 0,
      recentAccuracy: t.recent_accuracy === null ? null : Number(t.recent_accuracy),
      lastPracticedAt: t.last_practiced_at ? new Date(t.last_practiced_at) : null,
      mistakeCounts: t.mistake_counts ?? {},
    })),
  );
  const done = tasks.filter((t) => t.status === "done");
  const doneMin = done.reduce((s, t) => s + t.duration_minutes, 0);
  const plannedMin = tasks.filter((t) => t.status !== "skipped").reduce((s, t) => s + t.duration_minutes, 0);
  const byDate = new Map<string, (typeof tasks)[number][]>();
  for (const t of tasks) {
    const list = byDate.get(t.scheduled_date) ?? [];
    list.push(t);
    byDate.set(t.scheduled_date, list);
  }
  const unavailable = (exam.unavailable_dates ?? []).map((d: Date | string) => (typeof d === "string" ? d : d.toISOString().slice(0, 10))).join(", ");
  const warnings = (plan?.warnings ?? []) as string[];
  const active = exam.status === "upcoming" && daysLeft >= 0;

  return (
    <>
      <PageHeader
        eyebrow={<Link href={`/subjects/${exam.subject_id}`} className="hover:text-ivory">{exam.subject_name}</Link>}
        title={exam.title}
        description={`${formatDateTime(exam.exam_at, tz)} · ${daysLeft > 1 ? `${daysLeft} days left` : daysLeft === 1 ? "tomorrow" : daysLeft === 0 ? "today" : "date passed"}`}
        actions={
          <>
            <Dialog title="Edit exam" trigger="Edit">
              <ActionForm action={updateExam}>
                <input type="hidden" name="id" value={exam.id} />
                <Field label="Name" htmlFor="ee-title">
                  <Input id="ee-title" name="title" defaultValue={exam.title} required />
                </Field>
                <Field label="Date and time" htmlFor="ee-at">
                  <Input id="ee-at" name="examAt" type="datetime-local" defaultValue={toLocalInput(exam.exam_at, tz)} required />
                </Field>
                <Field label="Study hours per day" htmlFor="ee-h">
                  <Input id="ee-h" name="hoursPerDay" type="number" step="0.25" min="0.25" max="16" defaultValue={Number(exam.hours_per_day)} required />
                </Field>
                <Field label="Days you cannot study" htmlFor="ee-u" hint="YYYY-MM-DD, comma-separated.">
                  <Input id="ee-u" name="unavailable" defaultValue={unavailable} />
                </Field>
                <SubmitButton>Save and rebuild plan</SubmitButton>
              </ActionForm>
            </Dialog>
            {active && (
              <form action={regeneratePlanAction}>
                <input type="hidden" name="id" value={exam.id} />
                <SubmitButton size="sm" variant="secondary">
                  <RefreshCw className="size-3.5" /> Rebuild remaining plan
                </SubmitButton>
              </form>
            )}
            <ButtonLink href={`/generate?subject=${exam.subject_id}&kind=quiz`} size="sm" variant="primary">
              Mock exam
            </ButtonLink>
          </>
        }
      />

      {warnings.length > 0 && active && (
        <div className="mb-4 flex flex-col gap-2">
          {warnings.map((w) => (
            <Notice key={w} tone="warn">
              {w}
            </Notice>
          ))}
        </div>
      )}

      <div className="mb-4 grid gap-4 md:grid-cols-3">
        <Card className="p-5">
          <div className="text-xs text-muted">Readiness (from your practice)</div>
          <div className="mt-1 text-3xl font-semibold tabular-nums">{r.score === null ? "—" : `${Math.round(r.score * 100)}%`}</div>
          <div className="mt-2">
            <ProgressBar value={r.score ?? 0} label="Readiness" />
          </div>
          <p className="mt-2 text-[11px] text-faint">Based only on topic coverage, practice accuracy, recency, and repeated mistakes. It is not a grade prediction.</p>
        </Card>
        <Card className="p-5">
          <dl className="space-y-2 text-sm">
            {r.parts.map((p) => (
              <div key={p.label} className="flex justify-between gap-2">
                <dt className="text-muted">{p.label}</dt>
                <dd className="tabular-nums text-ivory">{p.value}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-2">
              <dt className="text-muted">Sessions done</dt>
              <dd className="tabular-nums text-ivory">
                {done.length} of {tasks.length} · {minutesLabel(doneMin)} of {minutesLabel(plannedMin)}
              </dd>
            </div>
          </dl>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-muted">What to focus on</div>
          {r.notes.length ? (
            <ul className="mt-2 space-y-1.5 text-sm text-ivory">
              {r.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted">Every topic has recent practice above 60%. Keep reviewing.</p>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Preparation plan" subtitle={plan ? `Built ${formatDateTime(plan.generated_at, tz)}. Rebuild after changing topics or when you miss sessions.` : undefined} />
          {tasks.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted">No sessions are scheduled. Add topics, or check the warnings above.</p>
          ) : (
            [...byDate.entries()].map(([date, list]) => (
              <section key={date} className="border-b border-line last:border-0">
                <h3 className="flex items-center justify-between bg-raised/40 px-4 py-2 text-xs font-medium sm:px-5">
                  <span className={date === today ? "text-gold" : "text-muted"}>
                    {date === today ? "Today" : formatDate(date, tz, { weekday: "short", month: "short", day: "numeric" })}
                  </span>
                  <span className="text-faint">{minutesLabel(list.reduce((s, t) => s + (t.status === "skipped" ? 0 : t.duration_minutes), 0))}</span>
                </h3>
                <ul className="divide-y divide-line">
                  {list.map((t) => (
                    <TaskRow key={t.id} t={t} />
                  ))}
                </ul>
              </section>
            ))
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Covered topics" subtitle="Difficulty and confidence shape how much time each topic gets." />
            <ul className="divide-y divide-line">
              {topics.map((t) => (
                <li key={t.id} className="px-4 py-3 sm:px-5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-ivory">{t.name}</span>
                    <span className="text-xs tabular-nums text-faint">{t.attempts ? `${Math.round(Number(t.recent_accuracy) * 100)}% · ${t.attempts} q` : "not practised"}</span>
                  </div>
                  <form action={setExamTopic} className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <input type="hidden" name="examId" value={exam.id} />
                    <input type="hidden" name="topicId" value={t.id} />
                    <label className="text-faint" htmlFor={`d-${t.id}`}>
                      Difficulty
                    </label>
                    <Select id={`d-${t.id}`} name="difficulty" defaultValue={t.difficulty} className="h-8 w-14 text-xs">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n}>{n}</option>
                      ))}
                    </Select>
                    <label className="text-faint" htmlFor={`c-${t.id}`}>
                      Confidence
                    </label>
                    <Select id={`c-${t.id}`} name="confidence" defaultValue={t.confidence} className="h-8 w-14 text-xs">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n}>{n}</option>
                      ))}
                    </Select>
                    <Button size="sm" variant="ghost" type="submit">
                      Save
                    </Button>
                    <button formAction={removeExamTopic} className="ml-auto text-faint hover:text-bad" aria-label={`Remove ${t.name}`}>
                      <Trash2 className="size-3.5" />
                    </button>
                  </form>
                </li>
              ))}
            </ul>
            <div className="border-t border-line px-4 py-3 sm:px-5">
              <ActionForm action={addExamTopics} resetOnSuccess>
                <input type="hidden" name="examId" value={exam.id} />
                {otherTopics.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {otherTopics.map((t) => (
                      <label key={t.id} className="flex cursor-pointer items-center gap-1.5 rounded-md border border-line px-2 py-1 text-xs has-[:checked]:border-gold/60">
                        <input type="checkbox" name="topicIds" value={t.id} className="accent-[#D6B36A]" /> {t.name}
                      </label>
                    ))}
                  </div>
                )}
                <Input name="newTopics" placeholder="New topics, comma-separated" aria-label="New topics" />
                <SubmitButton size="sm" variant="secondary">
                  Add topics
                </SubmitButton>
              </ActionForm>
            </div>
          </Card>
          <Card className="flex flex-wrap items-center gap-2 p-4">
            {exam.status === "upcoming" ? (
              <>
                <form action={setExamStatus}>
                  <input type="hidden" name="id" value={exam.id} />
                  <input type="hidden" name="status" value="done" />
                  <SubmitButton size="sm" variant="secondary">
                    Mark exam as taken
                  </SubmitButton>
                </form>
                <form action={setExamStatus}>
                  <input type="hidden" name="id" value={exam.id} />
                  <input type="hidden" name="status" value="cancelled" />
                  <SubmitButton size="sm" variant="ghost">
                    Cancel exam
                  </SubmitButton>
                </form>
              </>
            ) : (
              <Badge>{exam.status === "done" ? "Taken" : "Cancelled"}</Badge>
            )}
            <form action={deleteExam} className="ml-auto">
              <input type="hidden" name="id" value={exam.id} />
              <SubmitButton size="sm" variant="danger" confirm="Delete this exam and its plan? Logged study time is kept.">
                Delete
              </SubmitButton>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}
