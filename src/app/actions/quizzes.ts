"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { gradeObjective, type Answer, type QType } from "@/lib/study/grading";
import { analyzeMistakes, markAnswer, submitAttempt } from "@/lib/study/quiz";
import { AiError } from "@/lib/ai/provider";
import type { FormState } from "./auth";
import { describeAnswer } from "@/lib/study/describe";

const id = z.string().uuid();

export async function startAttempt(form: FormData) {
  const user = await requireUser();
  const quizId = id.parse(form.get("quizId"));
  const mode = z.enum(["practice", "exam", "mistakes"]).parse(form.get("mode"));
  const attemptId = await withUser(user.id, async (tx) => {
    const [quiz] = await tx`select id, config from quizzes where id = ${quizId}`;
    if (!quiz) throw new Error("Quiz not found");
    let qids: string[];
    if (mode === "mistakes") {
      // Questions answered incorrectly in the most recent attempt that had any mistakes.
      qids = (
        await tx`select distinct a.question_id from quiz_answers a
          where a.attempt_id = (select x.id from quiz_attempts x where x.quiz_id = ${quizId} and x.submitted_at is not null
                                 and exists (select 1 from quiz_answers y where y.attempt_id = x.id and (y.is_correct = false or y.score < 1))
                                 order by x.submitted_at desc limit 1)
            and (a.is_correct = false or a.score < 1)`
      ).map((r) => r.question_id);
      if (!qids.length) qids = (await tx`select id from quiz_questions where quiz_id = ${quizId} order by position`).map((r) => r.id);
    } else {
      qids = (await tx`select id from quiz_questions where quiz_id = ${quizId} order by position`).map((r) => r.id);
    }
    const cfgLimit = Number(quiz.config?.timeLimit) || null;
    const timeLimit = mode === "exam" ? (cfgLimit ?? Math.ceil(qids.length * 2.5)) * 60 : cfgLimit ? cfgLimit * 60 : null;
    const [a] = await tx`insert into quiz_attempts (user_id, quiz_id, mode, question_ids, time_limit_s) values (${user.id}, ${quizId}, ${mode}, ${qids}::uuid[], ${timeLimit}) returning id`;
    return a.id as string;
  });
  redirect(`/quizzes/${quizId}/take/${attemptId}`);
}

/** Immediate-feedback check for one question (practice mode). Only objective questions can be checked instantly. */
export async function checkOne(attemptId: string, questionId: string, response: string) {
  const user = await requireUser();
  id.parse(attemptId);
  id.parse(questionId);
  const [q] = await withUser(user.id, (tx) => tx`
    select q.qtype, q.answer, q.solution_md, q.choices from quiz_questions q join quiz_attempts a on q.id = any(a.question_ids)
    where a.id = ${attemptId} and q.id = ${questionId} and a.submitted_at is null and a.mode <> 'exam'`);
  if (!q) return { error: "Instant feedback is not available for this question." };
  const r = gradeObjective(q.qtype as QType, q.answer as Answer, response);
  if (!r) return { pending: true, feedback: "This answer will be graded when you submit." };
  return { ...r, solution: q.solution_md as string, correct: describeAnswer(q.qtype, q.answer, q.choices) };
}

export async function submitAttemptAction(attemptId: string, responses: Record<string, string>) {
  const user = await requireUser();
  id.parse(attemptId);
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(responses ?? {})) if (id.safeParse(k).success) clean[k] = String(v ?? "").slice(0, 5000);
  try {
    await submitAttempt(user.id, attemptId, clean);
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function markAnswerAction(form: FormData) {
  const user = await requireUser();
  const answerId = id.parse(form.get("answerId"));
  await markAnswer(user.id, answerId, form.get("correct") === "true");
  revalidatePath("/attempts", "layout");
}

export async function analyzeMistakesAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const attemptId = id.parse(form.get("attemptId"));
  try {
    const summary = await analyzeMistakes(user.id, attemptId);
    revalidatePath(`/attempts/${attemptId}`);
    return { ok: summary };
  } catch (e) {
    return { error: e instanceof AiError ? e.message : "The analysis failed. Your results are unchanged." };
  }
}

export async function deleteQuiz(form: FormData) {
  const user = await requireUser();
  const quizId = id.parse(form.get("id"));
  const [q] = await withUser(user.id, (tx) => tx`delete from quizzes where id = ${quizId} returning subject_id`);
  redirect(q ? `/subjects/${q.subject_id}?tab=quizzes` : "/subjects");
}
