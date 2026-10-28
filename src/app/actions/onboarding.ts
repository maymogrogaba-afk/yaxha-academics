"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import type { FormState } from "./auth";

export async function createSubjectInline(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = z.string().trim().min(1).max(200).safeParse(form.get("name"));
  if (!parsed.success) return { error: "Enter a subject name." };
  await withUser(user.id, (tx) => tx`insert into subjects (user_id, display_name) values (${user.id}, ${parsed.data})`);
  revalidatePath("/welcome");
  return { ok: `Added ${parsed.data}.` };
}
