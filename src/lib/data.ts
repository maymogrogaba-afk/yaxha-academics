import "server-only";
// Reusable read queries. All of them run through withUser, so Row Level Security applies.
import { withUser, type Tx } from "./db";

export type Prefs = {
  timezone: string;
  daily_target_minutes: number;
  session_minutes: number;
  break_minutes: number;
  available_days: number[];
  preferred_start: string;
  preferred_end: string;
  reminders_enabled: boolean;
  onboarding_done: boolean;
};

export async function getPrefs(tx: Tx): Promise<Prefs> {
  const [p] = await tx`select * from user_preferences`;
  return (
    (p as unknown as Prefs) ?? {
      timezone: "Asia/Manila",
      daily_target_minutes: 120,
      session_minutes: 45,
      break_minutes: 10,
      available_days: [1, 2, 3, 4, 5, 6],
      preferred_start: "19:00",
      preferred_end: "22:00",
      reminders_enabled: false,
      onboarding_done: false,
    }
  );
}

export async function loadPrefs(userId: string) {
  return withUser(userId, getPrefs);
}

export async function listSubjects(tx: Tx, includeHidden = false) {
  return tx`
    select s.*,
      (select count(*)::int from materials m where m.subject_id = s.id) as material_count,
      (select count(*)::int from materials m where m.subject_id = s.id and not m.seen_by_user and m.origin = 'imported') as new_count,
      (select count(*)::int from assignments a where a.subject_id = s.id and not a.completed and a.due_at > now()) as open_assignments,
      (select min(e.exam_at) from exams e where e.subject_id = s.id and e.status = 'upcoming' and e.exam_at > now()) as next_exam
    from subjects s
    where ${includeHidden ? tx`true` : tx`not s.hidden`}
    order by s.source_status = 'active' desc, s.display_name`;
}

export async function getSubject(tx: Tx, id: string) {
  if (!isUuid(id)) return null;
  const [s] = await tx`select * from subjects where id = ${id}`;
  return s ?? null;
}

export function isUuid(s: string | null | undefined): s is string {
  return typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

/** Summaries/quizzes/decks whose source material changed after they were generated. */
export async function outdatedPackIds(tx: Tx, subjectId: string) {
  const rows = await tx`
    select 'summary' as kind, s.id from summaries s
    where s.subject_id = ${subjectId} and exists (
      select 1 from material_versions v where v.material_id = any(s.source_material_ids) and v.detected_at > s.updated_at)
    union all
    select 'quiz', q.id from quizzes q
    where q.subject_id = ${subjectId} and exists (
      select 1 from material_versions v where v.material_id = any(q.source_material_ids) and v.detected_at > q.created_at)
    union all
    select 'deck', d.id from flashcard_decks d
    where d.subject_id = ${subjectId} and exists (
      select 1 from material_versions v where v.material_id = any(d.source_material_ids) and v.detected_at > d.created_at)`;
  return new Set(rows.map((r) => r.id as string));
}
