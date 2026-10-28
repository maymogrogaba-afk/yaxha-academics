"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import type { FormState } from "./auth";
import { getPrefs } from "@/lib/data";
import { zonedToDate } from "@/lib/study/dates";

const id = z.string().uuid();
const name = z.string().trim().min(1, "Enter a name.").max(200, "Keep the name under 200 characters.");

export async function createSubject(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = name.safeParse(form.get("name"));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const [row] = await withUser(user.id, (tx) =>
    tx`insert into subjects (user_id, display_name, source_provider) values (${user.id}, ${parsed.data}, 'manual') returning id`,
  );
  revalidatePath("/subjects");
  redirect(`/subjects/${row.id}`);
}

/** Changes only the name shown in Yaxha. The Classroom course and its id are untouched. */
export async function renameSubject(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = z.object({ id, name }).safeParse({ id: form.get("id"), name: form.get("name") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  await withUser(user.id, (tx) => tx`
    update subjects set display_name = ${parsed.data.name},
      name_customized = (source_course_name is not null and ${parsed.data.name} <> source_course_name)
    where id = ${parsed.data.id}`);
  revalidatePath("/", "layout");
  return { ok: "Subject renamed." };
}

export async function restoreSubjectName(form: FormData) {
  const user = await requireUser();
  const sid = id.parse(form.get("id"));
  await withUser(user.id, (tx) => tx`
    update subjects set display_name = left(source_course_name, 200), name_customized = false
    where id = ${sid} and source_course_name is not null`);
  revalidatePath("/", "layout");
}

export async function setSubjectHidden(form: FormData) {
  const user = await requireUser();
  const sid = id.parse(form.get("id"));
  const hidden = form.get("hidden") === "true";
  await withUser(user.id, (tx) => tx`update subjects set hidden = ${hidden} where id = ${sid}`);
  revalidatePath("/", "layout");
}

/** Only manually created subjects can be deleted (imported ones can be hidden instead). */
export async function deleteSubject(form: FormData) {
  const user = await requireUser();
  const sid = id.parse(form.get("id"));
  await withUser(user.id, (tx) => tx`delete from subjects where id = ${sid} and source_provider = 'manual'`);
  revalidatePath("/", "layout");
  redirect("/subjects");
}

export async function addTopic(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = z
    .object({ subjectId: id, name, importance: z.coerce.number().int().min(1).max(5).default(3) })
    .safeParse({ subjectId: form.get("subjectId"), name: form.get("name"), importance: form.get("importance") ?? 3 });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  await withUser(user.id, (tx) =>
    tx`insert into topics (user_id, subject_id, name, importance) values (${user.id}, ${parsed.data.subjectId}, ${parsed.data.name}, ${parsed.data.importance})`,
  );
  revalidatePath(`/subjects/${parsed.data.subjectId}`);
  return { ok: "Topic added." };
}

export async function setTopicImportance(form: FormData) {
  const user = await requireUser();
  const tid = id.parse(form.get("id"));
  const importance = z.coerce.number().int().min(1).max(5).parse(form.get("importance"));
  await withUser(user.id, (tx) => tx`update topics set importance = ${importance} where id = ${tid}`);
  revalidatePath("/subjects", "layout");
}

export async function deleteTopic(form: FormData) {
  const user = await requireUser();
  const tid = id.parse(form.get("id"));
  await withUser(user.id, (tx) => tx`delete from topics where id = ${tid} and source_topic_id is null`);
  revalidatePath("/subjects", "layout");
}

export async function createAssignment(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = z
    .object({ subjectId: id, title: name, due: z.string().optional(), instructions: z.string().max(5000).optional() })
    .safeParse({ subjectId: form.get("subjectId"), title: form.get("title"), due: form.get("due") || undefined, instructions: form.get("instructions") || undefined });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const tz = (await withUser(user.id, getPrefs)).timezone;
  const due = parsed.data.due ? zonedToDate(parsed.data.due, tz) : null;
  if (parsed.data.due && !due) return { error: "Enter a valid due date." };
  await withUser(user.id, (tx) => tx`
    insert into assignments (user_id, subject_id, title, due_at, instructions, origin)
    values (${user.id}, ${parsed.data.subjectId}, ${parsed.data.title}, ${due}, ${parsed.data.instructions ?? null}, 'manual')`);
  revalidatePath(`/subjects/${parsed.data.subjectId}`);
  revalidatePath("/home");
  return { ok: "Assignment added." };
}

export async function toggleAssignment(form: FormData) {
  const user = await requireUser();
  const aid = id.parse(form.get("id"));
  await withUser(user.id, (tx) => tx`update assignments set completed = not completed where id = ${aid}`);
  revalidatePath("/", "layout");
}
