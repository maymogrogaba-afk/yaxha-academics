import "server-only";
// Turns the pure planning logic into stored study tasks.
import type { Tx } from "../db";
import { getPrefs } from "../data";
import { buildExamPlan } from "./planner";
import { recommend, type RecInput } from "./recommend";
import { addDays, dateIn, todayIn, weekday } from "./dates";

/** Rebuilds the not-yet-done part of an exam plan. Completed, skipped, and missed sessions are kept as history. */
export async function regenerateExamPlan(tx: Tx, userId: string, examId: string) {
  const prefs = await getPrefs(tx);
  const today = todayIn(prefs.timezone);
  const [exam] = await tx`select * from exams where id = ${examId}`;
  if (!exam) throw new Error("Exam not found");
  const topics = await tx`
    select t.id, t.name, t.importance, et.difficulty, et.confidence, m.recent_accuracy, m.attempts,
      coalesce((select sum(st.duration_minutes) from study_tasks st where st.exam_id = ${examId} and st.topic_id = t.id and st.status = 'done'), 0)::int as done_minutes
    from exam_topics et join topics t on t.id = et.topic_id left join topic_mastery m on m.topic_id = t.id
    where et.exam_id = ${examId}`;
  const plan = buildExamPlan({
    today,
    examDate: dateIn(prefs.timezone, new Date(exam.exam_at)),
    minutesPerDay: Math.round(Number(exam.hours_per_day) * 60),
    sessionMinutes: prefs.session_minutes,
    availableWeekdays: prefs.available_days,
    unavailableDates: (exam.unavailable_dates ?? []).map((d: Date | string) => (typeof d === "string" ? d : d.toISOString().slice(0, 10))),
    examTitle: exam.title,
    topics: topics.map((t) => ({
      id: t.id,
      name: t.name,
      difficulty: t.difficulty,
      confidence: t.confidence,
      importance: t.importance,
      accuracy: t.recent_accuracy === null ? null : Number(t.recent_accuracy),
      practiced: t.attempts ?? 0,
      doneMinutes: t.done_minutes,
    })),
  });
  await tx`delete from study_tasks where exam_id = ${examId} and status in ('pending', 'deferred') and scheduled_date >= ${today}`;
  await tx`delete from study_plans where exam_id = ${examId}`;
  const [p] = await tx`insert into study_plans (user_id, exam_id, kind, warnings) values (${userId}, ${examId}, 'exam', ${tx.json(plan.warnings)}) returning id`;
  for (const t of plan.tasks) {
    await tx`insert into study_tasks (user_id, plan_id, exam_id, subject_id, topic_id, title, kind, scheduled_date, duration_minutes, priority, reason)
             values (${userId}, ${p.id}, ${examId}, ${exam.subject_id}, ${t.topicId}, ${t.title}, ${t.kind}, ${t.date}, ${t.minutes}, ${t.priority}, ${t.reason})`;
  }
  return plan;
}

/** Pending tasks from earlier days become "missed" (kept in history, never deleted). */
export async function markMissed(tx: Tx, today: string) {
  await tx`update study_tasks set status = 'missed' where status in ('pending', 'deferred') and scheduled_date < ${today}`;
}

export async function recommendationInput(tx: Tx, tz: string, sessionMinutes: number): Promise<RecInput> {
  const today = todayIn(tz);
  const [assignments, exams, topics, mastery, dueCards] = await Promise.all([
    tx`select a.id, a.title, a.subject_id, s.display_name, a.due_at, a.completed from assignments a join subjects s on s.id = a.subject_id
       where not s.hidden and a.due_at between now() - interval '3 days' and now() + interval '8 days'`,
    tx`select e.id, e.title, e.subject_id, s.display_name, e.exam_at, coalesce(array_agg(et.topic_id) filter (where et.topic_id is not null), '{}') as topic_ids
       from exams e join subjects s on s.id = e.subject_id left join exam_topics et on et.exam_id = e.id
       where e.status = 'upcoming' and e.exam_at > now() group by e.id, s.display_name`,
    tx`select t.id, t.name, t.subject_id, s.display_name, t.importance from topics t join subjects s on s.id = t.subject_id where not s.hidden`,
    tx`select topic_id, attempts, recent_accuracy, last_practiced_at, next_review_at, mistake_counts from topic_mastery`,
    tx`select d.id, d.subject_id, s.display_name, count(c.id)::int as n from flashcard_decks d join subjects s on s.id = d.subject_id
       join flashcards c on c.deck_id = d.id where c.due_at <= now() group by d.id, s.display_name`,
  ]);
  return {
    today,
    now: new Date(),
    sessionMinutes,
    assignments: assignments.map((a) => ({ id: a.id, title: a.title, subjectId: a.subject_id, subjectName: a.display_name, dueDate: a.due_at ? dateIn(tz, new Date(a.due_at)) : null, completed: a.completed })),
    exams: exams.map((e) => ({ id: e.id, title: e.title, subjectId: e.subject_id, subjectName: e.display_name, examDate: dateIn(tz, new Date(e.exam_at)), topicIds: e.topic_ids })),
    topics: topics.map((t) => ({ id: t.id, name: t.name, subjectId: t.subject_id, subjectName: t.display_name, importance: t.importance })),
    mastery: mastery.map((m) => ({
      topicId: m.topic_id,
      attempts: m.attempts,
      recentAccuracy: m.recent_accuracy === null ? null : Number(m.recent_accuracy),
      lastPracticedAt: m.last_practiced_at ? new Date(m.last_practiced_at) : null,
      nextReviewAt: m.next_review_at ? new Date(m.next_review_at) : null,
      mistakeCounts: m.mistake_counts ?? {},
    })),
    dueCards: dueCards.map((d) => ({ subjectId: d.subject_id, subjectName: d.display_name, deckId: d.id, count: d.n })),
  };
}

/**
 * Creates today's suggested tasks once per day: it tops up whatever is already
 * scheduled (exam sessions) with recommendations, up to the daily target.
 */
export async function ensureDailyPlan(tx: Tx, userId: string, opts: { refresh?: boolean } = {}) {
  const prefs = await getPrefs(tx);
  const today = todayIn(prefs.timezone);
  await markMissed(tx, today);
  const [existing] = await tx`select id from study_plans where kind = 'daily' and plan_date = ${today}`;
  if (existing && !opts.refresh) return { today, restDay: !prefs.available_days.includes(weekday(today)) };
  if (existing) {
    await tx`delete from study_tasks where plan_id = ${existing.id} and status = 'pending'`;
    await tx`delete from study_plans where id = ${existing.id}`;
  }
  const restDay = !prefs.available_days.includes(weekday(today));
  const [plan] = await tx`insert into study_plans (user_id, kind, plan_date) values (${userId}, 'daily', ${today}) returning id`;
  if (restDay) return { today, restDay };

  const [{ scheduled }] = await tx`select coalesce(sum(duration_minutes), 0)::int as scheduled from study_tasks
    where scheduled_date = ${today} and status in ('pending', 'done')`;
  let remaining = prefs.daily_target_minutes - scheduled;
  const already = await tx`select topic_id, assignment_id from study_tasks where scheduled_date = ${today}`;
  const recs = recommend(await recommendationInput(tx, prefs.timezone, prefs.session_minutes), 8);
  let added = 0;
  for (const r of recs) {
    if (remaining < 10 || added >= 4) break;
    if (r.topicId && already.some((a) => a.topic_id === r.topicId)) continue;
    const assignmentId = r.kind === "assignment" ? r.key.slice(2) : null;
    if (assignmentId && already.some((a) => a.assignment_id === assignmentId)) continue;
    const minutes = Math.max(10, Math.min(r.minutes, remaining));
    const kind = r.kind === "assignment" ? "assignment" : r.kind === "flashcards" ? "flashcards" : r.kind === "review" ? "review" : "practice";
    await tx`insert into study_tasks (user_id, plan_id, subject_id, topic_id, assignment_id, title, kind, scheduled_date, duration_minutes, priority, reason)
             values (${userId}, ${plan.id}, ${r.subjectId}, ${r.topicId ?? null}, ${assignmentId}, ${r.kind === "flashcards" ? r.title : `${labelFor(kind)}: ${r.title}`}, ${kind}, ${today}, ${minutes},
                     ${Math.min(5, Math.max(1, Math.round(r.score / 20)))}, ${r.reason})`;
    remaining -= minutes;
    added++;
  }
  return { today, restDay };
}

function labelFor(kind: string) {
  return kind === "assignment" ? "Work on" : kind === "review" ? "Review" : "Practice";
}

export function taskHref(t: { kind: string; subject_id: string | null; topic_id: string | null; exam_id?: string | null }) {
  const s = t.subject_id;
  if (!s) return "/study";
  switch (t.kind) {
    case "learn":
      return `/study?subject=${s}${t.topic_id ? `&topic=${t.topic_id}` : ""}&mode=teach`;
    case "practice":
    case "review":
      return `/study?subject=${s}${t.topic_id ? `&topic=${t.topic_id}` : ""}&mode=test`;
    case "flashcards":
      return `/subjects/${s}?tab=flashcards`;
    case "assignment":
      return `/subjects/${s}?tab=assignments`;
    case "mock_exam":
      return `/subjects/${s}?tab=quizzes`;
    default:
      return `/subjects/${s}`;
  }
}

export { addDays };
