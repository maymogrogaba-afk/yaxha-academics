import Link from "next/link";
import { notFound } from "next/navigation";
import { Clock, RotateCcw, Play } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { isUuid } from "@/lib/data";
import { QTYPE_LABELS } from "@/lib/ai/prompts";
import { formatDateTime } from "@/lib/study/dates";
import { Badge, Card, CardHeader, Notice, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { deleteQuiz, startAttempt } from "@/app/actions/quizzes";

export const metadata = { title: "Quiz" };

export default async function QuizPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const data = await withUser(user.id, async (tx) => {
    const [quiz] = await tx`select q.*, s.display_name as subject_name from quizzes q join subjects s on s.id = q.subject_id where q.id = ${id}`;
    if (!quiz) return null;
    const [{ tz }] = await tx`select coalesce((select timezone from user_preferences), 'Asia/Manila') as tz`;
    return {
      quiz,
      tz: tz as string,
      questions: await tx`select qtype, verification, topic_name from quiz_questions where quiz_id = ${id} order by position`,
      attempts: await tx`select id, mode, started_at, submitted_at, score, max_score, needs_review from quiz_attempts where quiz_id = ${id} order by started_at desc limit 20`,
    };
  });
  if (!data) notFound();
  const { quiz, questions, attempts, tz } = data;
  const types = [...new Set(questions.map((q) => q.qtype))];
  const topics = [...new Set(questions.map((q) => q.topic_name).filter(Boolean))];
  const mismatch = questions.filter((q) => q.verification === "mismatch").length;
  const verified = questions.filter((q) => q.verification === "verified").length;
  const numeric = questions.filter((q) => q.verification !== "not_applicable").length;
  const hasMistakes = attempts.some((a) => a.submitted_at && Number(a.score) < Number(a.max_score));
  const cfg = quiz.config ?? {};

  return (
    <>
      <PageHeader
        eyebrow={<Link href={`/subjects/${quiz.subject_id}?tab=quizzes`} className="hover:text-ivory">{quiz.subject_name} · Quizzes</Link>}
        title={quiz.title}
        description={`${questions.length} questions · ${types.map((t) => QTYPE_LABELS[t]).join(", ")}${cfg.difficulty ? ` · ${cfg.difficulty}` : ""}`}
      />
      {cfg.note && (
        <div className="mb-4">
          <Notice tone="warn">{cfg.note}</Notice>
        </div>
      )}
      {mismatch > 0 && (
        <div className="mb-4">
          <Notice tone="warn" title={`${mismatch} answer key${mismatch === 1 ? "" : "s"} failed the automatic re-check`}>
            Re-computing those answers from their formulas gave a different number. They are flagged in the results; treat them with care.
          </Notice>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card className="p-4 sm:p-5">
            <h2 className="text-sm font-semibold">Start</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <form action={startAttempt} className="flex flex-col gap-2 rounded-lg border border-line p-3">
                <input type="hidden" name="quizId" value={quiz.id} />
                <input type="hidden" name="mode" value="practice" />
                <div className="text-sm font-medium">Practice</div>
                <p className="flex-1 text-xs text-muted">{cfg.feedback === "immediate" ? "Check answers as you go." : "Feedback after you submit."} No pressure.</p>
                <SubmitButton size="sm">
                  <Play className="size-3.5" /> Practice
                </SubmitButton>
              </form>
              <form action={startAttempt} className="flex flex-col gap-2 rounded-lg border border-line p-3">
                <input type="hidden" name="quizId" value={quiz.id} />
                <input type="hidden" name="mode" value="exam" />
                <div className="text-sm font-medium">Exam simulation</div>
                <p className="flex-1 text-xs text-muted">Timed ({Number(cfg.timeLimit) || Math.ceil(questions.length * 2.5)} min), no hints, results at the end.</p>
                <SubmitButton size="sm" variant="secondary">
                  <Clock className="size-3.5" /> Start exam
                </SubmitButton>
              </form>
              <form action={startAttempt} className="flex flex-col gap-2 rounded-lg border border-line p-3">
                <input type="hidden" name="quizId" value={quiz.id} />
                <input type="hidden" name="mode" value="mistakes" />
                <div className="text-sm font-medium">Review mistakes</div>
                <p className="flex-1 text-xs text-muted">{hasMistakes ? "Retry only the questions you missed last time." : "Available after an attempt with mistakes."}</p>
                <SubmitButton size="sm" variant="secondary" disabled={!hasMistakes}>
                  <RotateCcw className="size-3.5" /> Retry missed
                </SubmitButton>
              </form>
            </div>
          </Card>
          <Card>
            <CardHeader title="Attempts" />
            {attempts.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted">No attempts yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {attempts.map((a) => (
                  <li key={a.id}>
                    <Link
                      href={a.submitted_at ? `/attempts/${a.id}` : `/quizzes/${quiz.id}/take/${a.id}`}
                      className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-raised/40 sm:px-5"
                    >
                      <span>
                        <span className="text-ivory">{a.mode === "exam" ? "Exam simulation" : a.mode === "mistakes" ? "Mistakes review" : "Practice"}</span>
                        <span className="ml-2 text-xs text-faint">{formatDateTime(a.started_at, tz)}</span>
                      </span>
                      {a.submitted_at ? (
                        <span className="flex items-center gap-2">
                          {a.needs_review > 0 && <Badge tone="warn">{a.needs_review} to review</Badge>}
                          <span className="tabular-nums text-ivory">
                            {Math.round((Number(a.score) / Math.max(1, Number(a.max_score))) * 100)}%
                          </span>
                        </span>
                      ) : (
                        <Badge>In progress — continue</Badge>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <Card className="p-4 sm:p-5">
          <h2 className="text-sm font-semibold">About this quiz</h2>
          <dl className="mt-3 space-y-3 text-sm">
            <div>
              <dt className="text-xs text-faint">Topics</dt>
              <dd className="mt-0.5 text-ivory">{topics.length ? topics.join(", ") : "—"}</dd>
            </div>
            {numeric > 0 && (
              <div>
                <dt className="text-xs text-faint">Numerical answer checks</dt>
                <dd className="mt-0.5 text-ivory">
                  {verified} of {numeric} re-computed and confirmed{mismatch ? `, ${mismatch} mismatched` : ""}
                </dd>
              </div>
            )}
            <div>
              <dt className="text-xs text-faint">Sources</dt>
              <dd className="mt-0.5 text-ivory">
                {(quiz.source_coverage ?? []).length
                  ? (quiz.source_coverage as { ref: string; title: string; usedLabels: string; partial: boolean }[]).map((c) => (
                      <div key={c.ref}>
                        {c.ref}: {c.title} ({c.usedLabels}){c.partial && <Badge tone="warn" className="ml-1">partial</Badge>}
                      </div>
                    ))
                  : "General course knowledge (no document)"}
              </dd>
            </div>
          </dl>
          <form action={deleteQuiz} className="mt-5 border-t border-line pt-4">
            <input type="hidden" name="id" value={quiz.id} />
            <SubmitButton variant="ghost" size="sm" confirm="Delete this quiz and all its attempts? Topic mastery already recorded is kept.">
              Delete quiz
            </SubmitButton>
          </form>
        </Card>
      </div>
    </>
  );
}
