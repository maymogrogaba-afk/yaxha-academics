import "server-only";
// Scoring quiz attempts and updating topic mastery from the real answers.
import { withUser, type Tx } from "../db";
import { aiAvailable } from "../ai/provider";
import { runAi, parseJsonReply } from "../ai/run";
import { gradePrompt, mistakePrompt } from "../ai/prompts";
import { gradeObjective, type Answer, type QType } from "./grading";
import { updateMastery } from "./srs";

type QuestionRow = { id: string; qtype: QType; prompt: string; answer: Answer; solution_md: string; rubric: string | null; topic_id: string | null };

export async function submitAttempt(userId: string, attemptId: string, responses: Record<string, string>) {
  const { questions } = await withUser(userId, async (tx) => {
    const [attempt] = await tx`select * from quiz_attempts where id = ${attemptId}`;
    if (!attempt) throw new Error("Attempt not found.");
    if (attempt.submitted_at) throw new Error("This attempt was already submitted.");
    const questions = (await tx`select id, qtype, prompt, answer, solution_md, rubric, topic_id from quiz_questions
      where id = any(${attempt.question_ids}::uuid[]) order by position`) as unknown as QuestionRow[];
    return { attempt, questions };
  });

  type Graded = { q: QuestionRow; response: string; isCorrect: boolean | null; score: number; needsReview: boolean; feedback: string; errorCategory: string | null };
  const graded: Graded[] = [];
  const freeText: { q: QuestionRow; response: string }[] = [];
  for (const q of questions) {
    const response = responses[q.id] ?? "";
    const r = gradeObjective(q.qtype, q.answer, response);
    if (r) graded.push({ q, response, ...r, errorCategory: null });
    else if (!String(response).trim()) graded.push({ q, response, isCorrect: false, score: 0, needsReview: false, feedback: "Not answered.", errorCategory: null });
    else freeText.push({ q, response });
  }

  // Free-text answers: graded by AI when configured, otherwise left for the student to mark.
  if (freeText.length) {
    let aiResults: Record<string, { score: number; verdict: string; feedback: string; error_category?: string }> = {};
    if (aiAvailable()) {
      try {
        const p = gradePrompt();
        const res = await runAi(userId, "grade", {
          system: p.system + `\nYou will receive several questions. Reply with ONLY JSON: {"results": {"<question id>": {score, verdict, feedback, error_category}}}`,
          maxTokens: 400 + freeText.length * 300,
          temperature: 0,
          messages: [
            {
              role: "user",
              content: freeText
                .map(({ q, response }) => `<question id="${q.id}">\n${q.prompt}\n<model_answer>${"text" in q.answer ? q.answer.text : JSON.stringify(q.answer)}</model_answer>\n<rubric>${q.rubric ?? ""}</rubric>\n<student_answer>${response}</student_answer>\n</question>`)
                .join("\n\n"),
            },
          ],
        });
        aiResults = parseJsonReply<{ results: typeof aiResults }>(res.text).results ?? {};
      } catch {
        aiResults = {};
      }
    }
    for (const { q, response } of freeText) {
      const r = aiResults[q.id];
      if (r && typeof r.score === "number" && r.verdict !== "unsure") {
        const score = Math.max(0, Math.min(1, r.score));
        graded.push({
          q,
          response,
          isCorrect: r.verdict === "correct" ? true : r.verdict === "incorrect" ? false : null,
          score,
          needsReview: r.verdict === "partial",
          feedback: `${r.feedback} (graded by AI — you can override this)`,
          errorCategory: r.error_category && r.error_category !== "none" ? r.error_category : null,
        });
      } else {
        graded.push({
          q,
          response,
          isCorrect: null,
          score: 0,
          needsReview: true,
          feedback: r ? `${r.feedback} The AI was unsure; compare with the solution and mark it yourself.` : "Compare your answer with the solution and mark it yourself.",
          errorCategory: null,
        });
      }
    }
  }

  await withUser(userId, async (tx) => {
    for (const g of graded) {
      await tx`insert into quiz_answers (user_id, attempt_id, question_id, response, is_correct, score, max_score, feedback, needs_review, error_category)
               values (${userId}, ${attemptId}, ${g.q.id}, ${tx.json(g.response)}, ${g.isCorrect}, ${g.score}, 1, ${g.feedback}, ${g.needsReview}, ${g.errorCategory})`;
    }
    await finalizeAttempt(tx, userId, attemptId);
  });
  return attemptId;
}

/** Recomputes the attempt score and refreshes mastery for the topics involved. */
export async function finalizeAttempt(tx: Tx, userId: string, attemptId: string) {
  const answers = await tx`
    select a.score, a.is_correct, a.needs_review, a.error_category, q.topic_id, t.subject_id
    from quiz_answers a join quiz_questions q on q.id = a.question_id left join topics t on t.id = q.topic_id
    where a.attempt_id = ${attemptId}`;
  const score = answers.reduce((s, a) => s + Number(a.score), 0);
  const review = answers.filter((a) => a.needs_review).length;
  const [prev] = await tx`select submitted_at from quiz_attempts where id = ${attemptId}`;
  await tx`update quiz_attempts set submitted_at = coalesce(submitted_at, now()), score = ${score}, max_score = ${answers.length}, needs_review = ${review} where id = ${attemptId}`;

  // Mastery is updated once, on first submission, from decided answers only.
  if (prev.submitted_at) return;
  const byTopic = new Map<string, { subjectId: string; score: number; total: number; mistakes: string[] }>();
  for (const a of answers) {
    if (!a.topic_id || a.needs_review) continue;
    const e = byTopic.get(a.topic_id) ?? { subjectId: a.subject_id as string, score: 0, total: 0, mistakes: [] as string[] };
    e.score += Number(a.score);
    e.total += 1;
    if (a.error_category) e.mistakes.push(a.error_category);
    byTopic.set(a.topic_id, e);
  }
  for (const [topicId, e] of byTopic) await applyMastery(tx, userId, topicId, e.subjectId, e.score, e.total, e.mistakes);
}

export async function applyMastery(tx: Tx, userId: string, topicId: string, subjectId: string, score: number, total: number, mistakes: string[]) {
  const [m] = await tx`select * from topic_mastery where topic_id = ${topicId}`;
  const next = updateMastery(
    {
      attempts: m?.attempts ?? 0,
      correct: Number(m?.correct ?? 0),
      recentAccuracy: m?.recent_accuracy === null || m?.recent_accuracy === undefined ? null : Number(m.recent_accuracy),
      intervalDays: m?.interval_days ?? 1,
      mistakeCounts: m?.mistake_counts ?? {},
    },
    score,
    total,
    mistakes,
  );
  await tx`
    insert into topic_mastery (user_id, topic_id, subject_id, attempts, correct, recent_accuracy, last_practiced_at, next_review_at, interval_days, mistake_counts, updated_at)
    values (${userId}, ${topicId}, ${subjectId}, ${next.attempts}, ${next.correct}, ${next.recentAccuracy}, now(), ${next.nextReviewAt}, ${next.intervalDays}, ${tx.json(next.mistakeCounts)}, now())
    on conflict (user_id, topic_id) do update set attempts = excluded.attempts, correct = excluded.correct, recent_accuracy = excluded.recent_accuracy,
      last_practiced_at = now(), next_review_at = excluded.next_review_at, interval_days = excluded.interval_days, mistake_counts = excluded.mistake_counts, updated_at = now()`;
}

/** Student overrides a grade ("I was right" / "I was wrong"). */
export async function markAnswer(userId: string, answerId: string, correct: boolean) {
  await withUser(userId, async (tx) => {
    const [prev] = await tx`select needs_review from quiz_answers where id = ${answerId}`;
    if (!prev) return;
    const [a] = await tx`update quiz_answers set is_correct = ${correct}, score = ${correct ? 1 : 0}, needs_review = false,
      feedback = coalesce(feedback, '') || ' (marked by you)' where id = ${answerId} returning attempt_id, question_id`;
    const [q] = await tx`select q.topic_id, t.subject_id from quiz_questions q left join topics t on t.id = q.topic_id where q.id = ${a.question_id}`;
    await finalizeAttempt(tx, userId, a.attempt_id);
    // Answers that were waiting for review were left out of mastery; count them now (once).
    if (prev.needs_review && q?.topic_id) await applyMastery(tx, userId, q.topic_id, q.subject_id, correct ? 1 : 0, 1, []);
  });
}

/** AI analysis of wrong answers: sets an error category per answer and records the pattern. */
export async function analyzeMistakes(userId: string, attemptId: string): Promise<string> {
  const wrong = await withUser(userId, (tx) => tx`
    select a.id, a.response, q.prompt, q.answer, q.solution_md, q.topic_id, t.subject_id
    from quiz_answers a join quiz_questions q on q.id = a.question_id left join topics t on t.id = q.topic_id
    where a.attempt_id = ${attemptId} and (a.is_correct = false or a.score < 1) and a.response is not null and a.error_category is null`);
  if (!wrong.length) return "There are no incorrect answers to analyse in this attempt.";
  const p = mistakePrompt();
  const res = await runAi(userId, "mistakes", {
    system: p.system,
    maxTokens: 600 + wrong.length * 250,
    temperature: 0,
    messages: [
      {
        role: "user",
        content: wrong
          .map((w) => `<item question_id="${w.id}">\nQuestion: ${w.prompt}\nCorrect answer: ${JSON.stringify(w.answer)}\nWorked solution: ${String(w.solution_md).slice(0, 1500)}\nStudent answer: ${JSON.stringify(w.response)}\n</item>`)
          .join("\n\n"),
      },
    ],
  });
  const parsed = parseJsonReply<{ items?: { question_id: string; category: string; explanation: string }[]; summary?: string }>(res.text);
  const valid = new Set(["formula_selection", "algebra", "unit_conversion", "conceptual", "missing_assumption", "interpretation", "arithmetic", "sequence"]);
  await withUser(userId, async (tx) => {
    for (const it of parsed.items ?? []) {
      if (!valid.has(it.category)) continue;
      const w = wrong.find((x) => x.id === it.question_id);
      if (!w) continue;
      await tx`update quiz_answers set error_category = ${it.category}, feedback = coalesce(feedback, '') || ${"\n\nLikely cause: " + it.explanation} where id = ${w.id}`;
      if (w.topic_id) {
        const [m] = await tx`select mistake_counts from topic_mastery where topic_id = ${w.topic_id}`;
        const counts = { ...(m?.mistake_counts ?? {}) };
        counts[it.category] = (counts[it.category] ?? 0) + 1;
        await tx`update topic_mastery set mistake_counts = ${tx.json(counts)} where topic_id = ${w.topic_id}`;
      }
    }
  });
  return parsed.summary ?? "Analysis complete.";
}
