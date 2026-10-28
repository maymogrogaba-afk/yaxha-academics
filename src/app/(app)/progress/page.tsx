import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { getPrefs } from "@/lib/data";
import { MISTAKE_LABELS } from "@/lib/study/recommend";
import { addDays, formatDate, minutesLabel, todayIn, dateIn } from "@/lib/study/dates";
import { Card, CardHeader, PageHeader, Stat, cx } from "@/components/ui";
import { BarChart, HBars, LineChart } from "@/components/charts";

export const metadata = { title: "Progress" };

const PERIODS = [
  { key: "7", label: "7 days" },
  { key: "30", label: "30 days" },
  { key: "90", label: "90 days" },
  { key: "all", label: "All time" },
];

export default async function ProgressPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const user = await requireUser();
  const requested = (await searchParams).period;
  const period = PERIODS.find((p) => p.key === requested)?.key ?? "30";
  const data = await withUser(user.id, async (tx) => {
    const prefs = await getPrefs(tx);
    const tz = prefs.timezone;
    const today = todayIn(tz);
    const firstActivity = (await tx`select least(
        (select min(started_at) from study_sessions), (select min(submitted_at) from quiz_attempts), (select min(created_at) from study_tasks)) as at`)[0].at;
    const start = period === "all" ? (firstActivity ? dateIn(tz, new Date(firstActivity)) : today) : addDays(today, -(Number(period) - 1));
    const since = tx`(${start}::date)::timestamp at time zone ${tz}`;
    const [sessions, tasks, attempts, bySubject, byTopic, mistakes, coverage, examActivity] = await Promise.all([
      tx`select (started_at at time zone ${tz})::date::text as day, sum(duration_minutes)::int as minutes, count(*)::int as n
         from study_sessions where started_at >= ${since} group by 1 order by 1`,
      tx`select count(*) filter (where status = 'done')::int as done, count(*) filter (where status <> 'skipped')::int as planned,
           count(*) filter (where status = 'missed')::int as missed, count(*) filter (where status = 'skipped')::int as skipped
         from study_tasks where scheduled_date between ${start} and ${today}`,
      tx`select a.submitted_at, a.score, a.max_score, q.title from quiz_attempts a join quizzes q on q.id = a.quiz_id
         where a.submitted_at >= ${since} order by a.submitted_at`,
      tx`select s.display_name, sum(x.score)::float as score, count(*)::int as n
         from quiz_answers x join quiz_attempts a on a.id = x.attempt_id join quizzes q on q.id = a.quiz_id join subjects s on s.id = q.subject_id
         where a.submitted_at >= ${since} and not x.needs_review group by s.display_name order by 2 / count(*)`,
      tx`select coalesce(t.name, qq.topic_name, 'General') as topic, s.display_name as subject, sum(x.score)::float as score, count(*)::int as n
         from quiz_answers x join quiz_attempts a on a.id = x.attempt_id join quiz_questions qq on qq.id = x.question_id
         join quizzes q on q.id = a.quiz_id join subjects s on s.id = q.subject_id left join topics t on t.id = qq.topic_id
         where a.submitted_at >= ${since} and not x.needs_review group by 1, 2 having count(*) >= 2 order by sum(x.score) / count(*) limit 8`,
      tx`select x.error_category as cat, count(*)::int as n from quiz_answers x join quiz_attempts a on a.id = x.attempt_id
         where a.submitted_at >= ${since} and x.error_category is not null group by 1 order by 2 desc`,
      tx`select count(*)::int as total, count(*) filter (where exists (select 1 from summaries s where m.id = any(s.source_material_ids))
           or exists (select 1 from quizzes q where m.id = any(q.source_material_ids)))::int as studied from materials m`,
      tx`select e.title, count(st.*) filter (where st.status = 'done')::int as done, count(st.*)::int as total
         from exams e left join study_tasks st on st.exam_id = e.id where e.status = 'upcoming' and e.exam_at > now() group by e.id order by e.exam_at`,
    ]);
    const [{ n: reviews }] = await tx`select count(*)::int as n from flashcard_reviews where reviewed_at >= ${since}`;
    return { tz, today, start, sessions, tasks: tasks[0], attempts, bySubject, byTopic, mistakes, coverage: coverage[0], examActivity, reviews };
  });

  const { tz, today, start, sessions, tasks, attempts } = data;
  const dayMap = new Map(sessions.map((s) => [s.day, s]));
  const days: { label: string; value: number; hint: string }[] = [];
  let totalMin = 0;
  let sessionCount = 0;
  let activeDays = 0;
  const spanDays = Math.min(366, Math.round((Date.parse(today) - Date.parse(start)) / 86_400_000) + 1);
  for (let i = 0; i < spanDays; i++) {
    const d = addDays(start, i);
    const s = dayMap.get(d);
    totalMin += s?.minutes ?? 0;
    sessionCount += s?.n ?? 0;
    if (s?.minutes) activeDays++;
    days.push({ label: formatDate(d, tz, { month: "short", day: "numeric" }), value: s?.minutes ?? 0, hint: `${s?.n ?? 0} sessions` });
  }
  // Long periods are grouped by week so bars stay readable.
  const chartDays =
    days.length > 45
      ? Array.from({ length: Math.ceil(days.length / 7) }, (_, w) => {
          const chunk = days.slice(w * 7, w * 7 + 7);
          return { label: `wk of ${chunk[0].label}`, value: chunk.reduce((s, d) => s + d.value, 0), hint: "weekly total" };
        })
      : days;
  const graded = attempts.filter((a) => Number(a.max_score) > 0);
  const avgScore = graded.length ? Math.round((graded.reduce((s, a) => s + Number(a.score) / Number(a.max_score), 0) / graded.length) * 100) : null;
  const empty = totalMin === 0 && graded.length === 0 && tasks.planned === 0;

  return (
    <>
      <PageHeader
        title="Progress"
        description="Everything here comes from what you actually recorded: study sessions, completed tasks, and graded quiz answers."
        actions={
          <nav className="flex rounded-lg border border-line p-0.5" aria-label="Time period">
            {PERIODS.map((p) => (
              <Link
                key={p.key}
                href={`/progress?period=${p.key}`}
                aria-current={p.key === period ? "page" : undefined}
                className={cx("rounded-md px-3 py-1.5 text-xs", p.key === period ? "bg-raised text-ivory" : "text-muted hover:text-ivory")}
              >
                {p.label}
              </Link>
            ))}
          </nav>
        }
      />
      {empty && (
        <Card className="mb-4 p-5 text-sm text-muted">
          No activity recorded in this period yet. Complete a task, take a quiz, or log study time, and it will show up here. Nothing is estimated or made up.
        </Card>
      )}
      <Card className="mb-4 grid grid-cols-2 gap-5 p-5 sm:grid-cols-4">
        <Stat label="Study time" value={minutesLabel(totalMin)} hint={`${activeDays} active day${activeDays === 1 ? "" : "s"}`} />
        <Stat label="Sessions" value={sessionCount} />
        <Stat label="Planned tasks done" value={tasks.planned ? `${tasks.done}/${tasks.planned}` : "—"} hint={tasks.missed ? `${tasks.missed} missed, ${tasks.skipped} skipped` : undefined} />
        <Stat label="Average quiz score" value={avgScore === null ? "—" : `${avgScore}%`} hint={`${graded.length} quiz${graded.length === 1 ? "" : "zes"}`} />
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Study time" subtitle={days.length > 45 ? "Minutes per week" : "Minutes per day"} />
          <div className="p-4 sm:p-5">
            <BarChart points={chartDays} unit=" min" ariaLabel="Study minutes over time" empty="No study sessions logged in this period." />
          </div>
        </Card>
        <Card>
          <CardHeader title="Quiz scores" subtitle="Each submitted attempt, in order" />
          <div className="p-4 sm:p-5">
            <LineChart
              ariaLabel="Quiz scores over time"
              points={graded.map((a) => ({
                label: formatDate(new Date(a.submitted_at), tz, { month: "short", day: "numeric" }),
                value: Math.round((Number(a.score) / Number(a.max_score)) * 100),
                hint: a.title,
              }))}
            />
          </div>
        </Card>
        <Card>
          <CardHeader title="Accuracy by subject" subtitle="Graded answers only (excludes answers awaiting your review)" />
          <div className="p-4 sm:p-5">
            <HBars rows={data.bySubject.map((s) => ({ label: s.display_name, value: Math.round((s.score / s.n) * 100), note: `${s.n} answers` }))} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Weakest topics" subtitle="Lowest accuracy first (topics with 2+ graded answers)" />
          <div className="p-4 sm:p-5">
            <HBars rows={data.byTopic.map((t) => ({ label: t.topic, value: Math.round((t.score / t.n) * 100), note: `${t.subject} · ${t.n} answers` }))} />
          </div>
        </Card>
        <Card className="p-4 sm:p-5">
          <h2 className="text-sm font-semibold">Recurring mistakes</h2>
          <p className="mt-1 text-xs text-muted">From mistake analysis on your quiz results.</p>
          {data.mistakes.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No analysed mistakes in this period. Use “Analyse my mistakes” on a quiz result.</p>
          ) : (
            <ul className="mt-3 space-y-1.5 text-sm">
              {data.mistakes.map((m) => (
                <li key={m.cat} className="flex justify-between">
                  <span className="text-ivory">{MISTAKE_LABELS[m.cat] ?? m.cat}</span>
                  <span className="tabular-nums text-muted">{m.n}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-4 sm:p-5">
          <h2 className="text-sm font-semibold">Coverage and exam preparation</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">Materials studied (summary or quiz made)</dt>
              <dd className="tabular-nums text-ivory">
                {data.coverage.studied} / {data.coverage.total}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Flashcard reviews</dt>
              <dd className="tabular-nums text-ivory">{data.reviews}</dd>
            </div>
            {data.examActivity.map((e) => (
              <div key={e.title} className="flex justify-between">
                <dt className="text-muted">Exam plan: {e.title}</dt>
                <dd className="tabular-nums text-ivory">
                  {e.done}/{e.total} sessions
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </>
  );
}
