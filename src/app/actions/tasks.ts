"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { getPrefs } from "@/lib/data";
import { addDays, todayIn } from "@/lib/study/dates";
import { ensureDailyPlan } from "@/lib/study/plans";
import type { FormState } from "./auth";

const id = z.string().uuid();

function refresh() {
  revalidatePath("/home");
  revalidatePath("/exams", "layout");
  revalidatePath("/progress");
}

/** Marks a task done and records the study time as a session. */
export async function completeTask(form: FormData) {
  const user = await requireUser();
  const tid = id.parse(form.get("id"));
  const minutes = z.coerce.number().int().min(0).max(600).catch(0).parse(form.get("minutes"));
  await withUser(user.id, async (tx) => {
    const [t] = await tx`update study_tasks set status = 'done', completed_at = now() where id = ${tid} and status <> 'done'
                         returning subject_id, topic_id, duration_minutes, kind`;
    if (!t) return;
    const m = minutes || t.duration_minutes;
    await tx`insert into study_sessions (user_id, subject_id, topic_id, task_id, kind, duration_minutes, started_at, ended_at)
             values (${user.id}, ${t.subject_id}, ${t.topic_id}, ${tid}, ${t.kind}, ${m}, now() - make_interval(mins => ${m}), now())`;
  });
  refresh();
}

export async function undoTask(form: FormData) {
  const user = await requireUser();
  const tid = id.parse(form.get("id"));
  await withUser(user.id, async (tx) => {
    await tx`delete from study_sessions where task_id = ${tid}`;
    await tx`update study_tasks set status = 'pending', completed_at = null where id = ${tid}`;
  });
  refresh();
}

export async function skipTask(form: FormData) {
  const user = await requireUser();
  const tid = id.parse(form.get("id"));
  await withUser(user.id, (tx) => tx`update study_tasks set status = 'skipped' where id = ${tid} and status <> 'done'`);
  refresh();
}

/** Moves a task to today, tomorrow, or a chosen date. The original date is remembered. */
export async function rescheduleTask(form: FormData) {
  const user = await requireUser();
  const tid = id.parse(form.get("id"));
  const to = z.string().parse(form.get("to"));
  await withUser(user.id, async (tx) => {
    const prefs = await getPrefs(tx);
    const today = todayIn(prefs.timezone);
    const date = to === "today" ? today : to === "tomorrow" ? addDays(today, 1) : /^\d{4}-\d{2}-\d{2}$/.test(to) && to >= today ? to : null;
    if (!date) return;
    await tx`update study_tasks set rescheduled_from = coalesce(rescheduled_from, scheduled_date), scheduled_date = ${date}, status = 'pending'
             where id = ${tid} and status <> 'done'`;
  });
  refresh();
}

export async function addCustomTask(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = z
    .object({
      title: z.string().trim().min(1, "Describe the task.").max(200),
      subjectId: z.union([id, z.literal("")]),
      minutes: z.coerce.number().int().min(5).max(480),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    })
    .safeParse({ title: form.get("title"), subjectId: form.get("subjectId") ?? "", minutes: form.get("minutes"), date: form.get("date") || undefined });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  await withUser(user.id, async (tx) => {
    const prefs = await getPrefs(tx);
    await tx`insert into study_tasks (user_id, subject_id, title, kind, scheduled_date, duration_minutes, reason)
             values (${user.id}, ${parsed.data.subjectId || null}, ${parsed.data.title}, 'custom', ${parsed.data.date ?? todayIn(prefs.timezone)}, ${parsed.data.minutes}, 'Added by you.')`;
  });
  refresh();
  return { ok: "Task added." };
}

export async function refreshDailyPlan() {
  const user = await requireUser();
  await withUser(user.id, (tx) => ensureDailyPlan(tx, user.id, { refresh: true }));
  refresh();
}

/** Logs a free study session (e.g. from the Start Studying timer). */
export async function logSession(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = z
    .object({ subjectId: z.union([id, z.literal("")]), minutes: z.coerce.number().int().min(1).max(600), notes: z.string().max(1000).optional() })
    .safeParse({ subjectId: form.get("subjectId") ?? "", minutes: form.get("minutes"), notes: form.get("notes") || undefined });
  if (!parsed.success) return { error: "Enter the minutes you studied." };
  await withUser(user.id, (tx) => tx`insert into study_sessions (user_id, subject_id, kind, duration_minutes, started_at, ended_at, notes)
    values (${user.id}, ${parsed.data.subjectId || null}, 'study', ${parsed.data.minutes}, now() - make_interval(mins => ${parsed.data.minutes}), now(), ${parsed.data.notes ?? null})`);
  refresh();
  return { ok: `Logged ${parsed.data.minutes} minutes.` };
}
