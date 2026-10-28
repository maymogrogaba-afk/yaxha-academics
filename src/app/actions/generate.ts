"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { AiError } from "@/lib/ai/provider";
import { generateFlashcards, generateQuiz, generateSummary } from "@/lib/ai/generate";
import { SUMMARY_MODES } from "@/lib/ai/prompts";
import type { FormState } from "./auth";

const uuid = z.string().uuid();
const optUuid = z.union([uuid, z.literal("")]).transform((v) => v || null);
const optPage = z.union([z.coerce.number().int().min(1).max(5000), z.literal("")]).transform((v) => (v === "" ? null : v));

const common = z.object({
  subjectId: uuid,
  topicId: optUuid,
  materialIds: z.array(uuid).max(10, "Choose at most 10 materials at a time."),
  summaryId: optUuid,
  pageFrom: optPage,
  pageTo: optPage,
});

function readCommon(form: FormData) {
  return common.safeParse({
    subjectId: form.get("subjectId"),
    topicId: form.get("topicId") ?? "",
    materialIds: form.getAll("materialIds"),
    summaryId: form.get("summaryId") ?? "",
    pageFrom: form.get("pageFrom") ?? "",
    pageTo: form.get("pageTo") ?? "",
  });
}

function aiErrorState(e: unknown): FormState {
  if (e instanceof AiError) return { error: e.message };
  console.error("generation failed", e);
  return { error: "Something went wrong while generating. Nothing was saved. Please try again." };
}

export async function generateSummaryAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const c = readCommon(form);
  const extra = z
    .object({ mode: z.enum(Object.keys(SUMMARY_MODES) as [keyof typeof SUMMARY_MODES]), instructions: z.string().max(1000).optional(), regenerateId: optUuid })
    .safeParse({ mode: form.get("mode"), instructions: form.get("instructions") || undefined, regenerateId: form.get("regenerateId") ?? "" });
  if (!c.success || !extra.success) return { error: (c.error ?? extra.error)!.issues[0].message };
  let id: string;
  try {
    const res = await generateSummary(user.id, { ...c.data, ...extra.data });
    id = res.id;
  } catch (e) {
    return aiErrorState(e);
  }
  revalidatePath(`/subjects/${c.data.subjectId}`);
  redirect(`/summaries/${id}`);
}

export async function generateQuizAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const c = readCommon(form);
  const cfg = z
    .object({
      count: z.coerce.number().int().min(1).max(30),
      difficulty: z.enum(["easy", "medium", "hard", "mixed"]),
      types: z.array(z.enum(["multiple_choice", "true_false", "short_answer", "numerical", "formula", "multi_step"])).min(1, "Choose at least one question type."),
      topics: z.string().max(500).default(""),
      instructions: z.string().max(1000).default(""),
      includeSolutions: z.boolean(),
      timeLimit: z.union([z.coerce.number().int().min(1).max(300), z.literal("")]).transform((v) => (v === "" ? null : v)),
      feedback: z.enum(["immediate", "after"]),
    })
    .safeParse({
      count: form.get("count"),
      difficulty: form.get("difficulty"),
      types: form.getAll("types"),
      topics: form.get("topics") ?? "",
      instructions: form.get("instructions") ?? "",
      includeSolutions: form.get("includeSolutions") === "on",
      timeLimit: form.get("timeLimit") ?? "",
      feedback: form.get("feedback") ?? "after",
    });
  if (!c.success || !cfg.success) return { error: (c.error ?? cfg.error)!.issues[0].message };
  let id: string;
  try {
    const { timeLimit, feedback, ...quizCfg } = cfg.data;
    const res = await generateQuiz(user.id, { ...c.data, config: { ...quizCfg, ...{ timeLimit, feedback } } as typeof quizCfg });
    id = res.id;
  } catch (e) {
    return aiErrorState(e);
  }
  revalidatePath(`/subjects/${c.data.subjectId}`);
  redirect(`/quizzes/${id}`);
}

export async function generateFlashcardsAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const c = readCommon(form);
  const cnt = z.coerce.number().int().min(3).max(60).safeParse(form.get("count"));
  if (!c.success || !cnt.success) return { error: (c.error ?? cnt.error)!.issues[0].message };
  let id: string;
  try {
    const res = await generateFlashcards(user.id, { ...c.data, count: cnt.data });
    id = res.id;
  } catch (e) {
    return aiErrorState(e);
  }
  revalidatePath(`/subjects/${c.data.subjectId}`);
  redirect(`/decks/${id}`);
}
