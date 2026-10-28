"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import type { FormState } from "./auth";

const id = z.string().uuid();

export async function saveSummary(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = z
    .object({ id, title: z.string().trim().min(1, "Enter a title.").max(160), body: z.string().min(1, "The summary cannot be empty.").max(400_000), topicId: z.union([id, z.literal("")]) })
    .safeParse({ id: form.get("id"), title: form.get("title"), body: form.get("body"), topicId: form.get("topicId") ?? "" });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  await withUser(user.id, (tx) => tx`update summaries set title = ${d.title}, body_md = ${d.body}, topic_id = ${d.topicId || null}, edited = true where id = ${d.id}`);
  revalidatePath(`/summaries/${d.id}`);
  redirect(`/summaries/${d.id}`);
}

export async function deleteSummary(form: FormData) {
  const user = await requireUser();
  const sid = id.parse(form.get("id"));
  const [s] = await withUser(user.id, (tx) => tx`delete from summaries where id = ${sid} returning subject_id`);
  redirect(s ? `/subjects/${s.subject_id}?tab=summaries` : "/subjects");
}
