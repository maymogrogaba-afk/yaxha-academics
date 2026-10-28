"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { regenerateExamPlan } from "@/lib/study/plans";
import { getPrefs } from "@/lib/data";
import { zonedToDate } from "@/lib/study/dates";
import type { FormState } from "./auth";

const id = z.string().uuid();
const level = z.coerce.number().int().min(1).max(5);

function parseDates(raw: string) {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));
}

export async function createExam(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = z
    .object({
      subjectId: id,
      title: z.string().trim().min(1, "Give the exam a name.").max(160),
      examAt: z.string().min(1, "Enter the exam date and time."),
      difficulty: level,
      confidence: level,
      hoursPerDay: z.coerce.number().min(0.25, "Enter at least 15 minutes a day.").max(16),
      unavailable: z.string().max(2000).default(""),
      topicIds: z.array(id).default([]),
      newTopics: z.string().max(2000).default(""),
      notes: z.string().max(2000).optional(),
    })
    .safeParse({
      subjectId: form.get("subjectId"),
      title: form.get("title"),
      examAt: form.get("examAt"),
      difficulty: form.get("difficulty") ?? 3,
      confidence: form.get("confidence") ?? 3,
      hoursPerDay: form.get("hoursPerDay"),
      unavailable: form.get("unavailable") ?? "",
      topicIds: form.getAll("topicIds"),
      newTopics: form.get("newTopics") ?? "",
      notes: form.get("notes") || undefined,
    });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  // The form's date/time is in the user's time zone (Asia/Manila by default); it is stored as an absolute time.
  const tz = (await withUser(user.id, getPrefs)).timezone;
  const examAt = zonedToDate(d.examAt, tz);
  if (!examAt) return { error: "Enter a valid exam date and time." };
  if (examAt.getTime() < Date.now()) return { error: "The exam date is in the past." };
  const examId = await withUser(user.id, async (tx) => {
    const [subject] = await tx`select id from subjects where id = ${d.subjectId}`;
    if (!subject) throw new Error("Subject not found");
    const [e] = await tx`insert into exams (user_id, subject_id, title, exam_at, difficulty, confidence, hours_per_day, unavailable_dates, notes)
      values (${user.id}, ${d.subjectId}, ${d.title}, ${examAt}, ${d.difficulty}, ${d.confidence}, ${d.hoursPerDay}, ${parseDates(d.unavailable)}::date[], ${d.notes ?? null})
      returning id`;
    const topicIds = [...d.topicIds];
    for (const name of d.newTopics.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean).slice(0, 30)) {
      const [t] = await tx`insert into topics (user_id, subject_id, name) values (${user.id}, ${d.subjectId}, ${name.slice(0, 200)}) returning id`;
      topicIds.push(t.id);
    }
    for (const tid of new Set(topicIds)) {
      await tx`insert into exam_topics (exam_id, topic_id, user_id, difficulty, confidence)
               select ${e.id}, t.id, ${user.id}, ${d.difficulty}, ${d.confidence} from topics t where t.id = ${tid} and t.subject_id = ${d.subjectId}
               on conflict do nothing`;
    }
    await regenerateExamPlan(tx, user.id, e.id);
    return e.id as string;
  });
  revalidatePath("/exams");
  revalidatePath("/home");
  redirect(`/exams/${examId}`);
}

export async function updateExam(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = z
    .object({
      id,
      title: z.string().trim().min(1).max(160),
      examAt: z.string().min(1),
      hoursPerDay: z.coerce.number().min(0.25).max(16),
      unavailable: z.string().max(2000).default(""),
    })
    .safeParse({ id: form.get("id"), title: form.get("title"), examAt: form.get("examAt"), hoursPerDay: form.get("hoursPerDay"), unavailable: form.get("unavailable") ?? "" });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const examAt = zonedToDate(parsed.data.examAt, (await withUser(user.id, getPrefs)).timezone);
  if (!examAt) return { error: "Enter a valid exam date and time." };
  await withUser(user.id, async (tx) => {
    await tx`update exams set title = ${parsed.data.title}, exam_at = ${examAt}, hours_per_day = ${parsed.data.hoursPerDay},
             unavailable_dates = ${parseDates(parsed.data.unavailable)}::date[] where id = ${parsed.data.id}`;
    await regenerateExamPlan(tx, user.id, parsed.data.id);
  });
  revalidatePath(`/exams/${parsed.data.id}`);
  return { ok: "Saved, and the remaining plan was rebuilt." };
}

export async function setExamTopic(form: FormData) {
  const user = await requireUser();
  const examId = id.parse(form.get("examId"));
  const topicId = id.parse(form.get("topicId"));
  const difficulty = level.parse(form.get("difficulty"));
  const confidence = level.parse(form.get("confidence"));
  await withUser(user.id, (tx) => tx`update exam_topics set difficulty = ${difficulty}, confidence = ${confidence} where exam_id = ${examId} and topic_id = ${topicId}`);
  revalidatePath(`/exams/${examId}`);
}

export async function addExamTopics(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const examId = id.parse(form.get("examId"));
  const ids = z.array(id).parse(form.getAll("topicIds"));
  const names = String(form.get("newTopics") ?? "").split(/[\n,]+/).map((s) => s.trim()).filter(Boolean).slice(0, 30);
  if (!ids.length && !names.length) return { error: "Choose or type at least one topic." };
  await withUser(user.id, async (tx) => {
    const [e] = await tx`select subject_id, difficulty, confidence from exams where id = ${examId}`;
    if (!e) return;
    const all = [...ids];
    for (const n of names) all.push((await tx`insert into topics (user_id, subject_id, name) values (${user.id}, ${e.subject_id}, ${n.slice(0, 200)}) returning id`)[0].id);
    for (const t of all) {
      await tx`insert into exam_topics (exam_id, topic_id, user_id, difficulty, confidence)
               select ${examId}, id, ${user.id}, ${e.difficulty}, ${e.confidence} from topics where id = ${t} and subject_id = ${e.subject_id} on conflict do nothing`;
    }
    await regenerateExamPlan(tx, user.id, examId);
  });
  revalidatePath(`/exams/${examId}`);
  return { ok: "Topics added and plan rebuilt." };
}

export async function removeExamTopic(form: FormData) {
  const user = await requireUser();
  const examId = id.parse(form.get("examId"));
  const topicId = id.parse(form.get("topicId"));
  await withUser(user.id, async (tx) => {
    await tx`delete from exam_topics where exam_id = ${examId} and topic_id = ${topicId}`;
    await regenerateExamPlan(tx, user.id, examId);
  });
  revalidatePath(`/exams/${examId}`);
}

export async function regeneratePlanAction(form: FormData) {
  const user = await requireUser();
  const examId = id.parse(form.get("id"));
  await withUser(user.id, (tx) => regenerateExamPlan(tx, user.id, examId));
  revalidatePath(`/exams/${examId}`);
  revalidatePath("/home");
}

export async function setExamStatus(form: FormData) {
  const user = await requireUser();
  const examId = id.parse(form.get("id"));
  const status = z.enum(["upcoming", "done", "cancelled"]).parse(form.get("status"));
  await withUser(user.id, async (tx) => {
    await tx`update exams set status = ${status} where id = ${examId}`;
    if (status !== "upcoming") await tx`delete from study_tasks where exam_id = ${examId} and status = 'pending'`;
  });
  revalidatePath("/exams", "layout");
  revalidatePath("/home");
}

export async function deleteExam(form: FormData) {
  const user = await requireUser();
  const examId = id.parse(form.get("id"));
  await withUser(user.id, (tx) => tx`delete from exams where id = ${examId}`);
  revalidatePath("/home");
  redirect("/exams");
}
