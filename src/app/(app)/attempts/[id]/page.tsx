import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, RotateCcw, Sparkles, X } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { isUuid } from "@/lib/data";
import { aiAvailable } from "@/lib/ai/provider";
import { describeAnswer, describeResponse } from "@/lib/study/describe";
import { MISTAKE_LABELS } from "@/lib/study/recommend";
import { Badge, ButtonLink, Card, Notice, PageHeader, ProgressBar, cx } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { ActionForm } from "@/components/action-form";
import { Markdown } from "@/components/markdown";
import { analyzeMistakesAction, markAnswerAction, startAttempt } from "@/app/actions/quizzes";

export const metadata = { title: "Quiz results" };
export const maxDuration = 120;

export default async function AttemptPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const data = await withUser(user.id, async (tx) => {
    const [a] = await tx`select a.*, q.title, q.config, q.subject_id, q.topic_id as quiz_topic_id from quiz_attempts a join quizzes q on q.id = a.quiz_id where a.id = ${id}`;
    if (!a) return null;
    const rows = await tx`
      select q.id as question_id, q.position, q.qtype, q.prompt, q.choices, q.answer, q.solution_md, q.topic_name, q.topic_id,
        q.verification, q.verification_note, x.id as answer_id, x.response, x.is_correct, x.score, x.feedback, x.needs_review, x.error_category
      from quiz_questions q left join quiz_answers x on x.question_id = q.id and x.attempt_id = ${id}
      where q.id = any(${a.question_ids}::uuid[]) order by q.position`;
    return { a, rows };
  });
  if (!data) notFound();
  const { a, rows } = data;
  if (!a.submitted_at) {
    return (
      <Notice tone="info" title="This attempt has not been submitted yet" action={<ButtonLink href={`/quizzes/${a.quiz_id}/take/${a.id}`}>Continue</ButtonLink>} />
    );
  }
  const score = Number(a.score);
  const max = Number(a.max_score) || rows.length;
  const pct = max ? score / max : 0;
  const showSolutions = a.config?.includeSolutions !== false;

  // Topic-level performance from this attempt's decided answers
  const byTopic = new Map<string, { score: number; n: number }>();
  for (const r of rows) {
    if (r.needs_review) continue;
    const k = r.topic_name ?? "General";
    const e = byTopic.get(k) ?? { score: 0, n: 0 };
    e.score += Number(r.score ?? 0);
    e.n += 1;
    byTopic.set(k, e);
  }
  const wrong = rows.filter((r) => r.is_correct === false || (Number(r.score) < 1 && !r.needs_review));
  const categories = new Map<string, number>();
  for (const r of rows) if (r.error_category) categories.set(r.error_category, (categories.get(r.error_category) ?? 0) + 1);

  return (
    <>
      <PageHeader
        eyebrow={<Link href={`/quizzes/${a.quiz_id}`} className="hover:text-ivory">{a.title}</Link>}
        title="Results"
        actions={
          <>
            {wrong.length > 0 && (
              <form action={startAttempt}>
                <input type="hidden" name="quizId" value={a.quiz_id} />
                <input type="hidden" name="mode" value="mistakes" />
                <SubmitButton size="sm" variant="secondary">
                  <RotateCcw className="size-3.5" /> Retry incorrect
                </SubmitButton>
              </form>
            )}
            <ButtonLink href={`/study?subject=${a.subject_id}&mode=fix${a.quiz_topic_id ? `&topic=${a.quiz_topic_id}` : ""}`} size="sm" variant="primary">
              <Sparkles className="size-4" /> Practise with the tutor
            </ButtonLink>
          </>
        }
      />

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <Card className="p-5">
          <div className="text-xs text-muted">Score</div>
          <div className="mt-1 text-3xl font-semibold tabular-nums">{Math.round(pct * 100)}%</div>
          <div className="mt-1 text-xs text-faint">
            {Math.round(score * 10) / 10} of {max} points{a.needs_review > 0 ? ` · ${a.needs_review} waiting for your review (counted as 0 until marked)` : ""}
          </div>
          <div className="mt-3">
            <ProgressBar value={pct} label="Score" />
          </div>
        </Card>
        <Card className="p-5 md:col-span-2">
          <div className="text-xs text-muted">By topic</div>
          <ul className="mt-2 space-y-2">
            {[...byTopic.entries()].map(([t, e]) => (
              <li key={t} className="grid grid-cols-[minmax(0,1fr)_120px_40px] items-center gap-3 text-sm">
                <span className="truncate text-ivory">{t}</span>
                <ProgressBar value={e.n ? e.score / e.n : 0} label={t} />
                <span className="text-right text-xs tabular-nums text-muted">{Math.round((e.score / Math.max(1, e.n)) * 100)}%</span>
              </li>
            ))}
          </ul>
          {categories.size > 0 && (
            <p className="mt-3 text-xs text-muted">
              Mistake types: {[...categories.entries()].map(([k, n]) => `${MISTAKE_LABELS[k] ?? k} (${n})`).join(", ")}
            </p>
          )}
        </Card>
      </div>

      {wrong.length > 0 && (
        <Card className="mb-6 p-4 sm:p-5">
          <h2 className="text-sm font-semibold">Fix my mistakes</h2>
          <p className="mt-1 text-sm text-muted">
            {aiAvailable()
              ? "The AI reviews each incorrect answer against the worked solution and names the most likely cause (formula choice, algebra, units, …). This also guides your recommendations."
              : "Mistake analysis uses AI, which is not configured on this server yet. You can still compare your answers with the worked solutions below."}
          </p>
          {aiAvailable() && (
            <ActionForm action={analyzeMistakesAction} className="mt-3 flex flex-col gap-2">
              <input type="hidden" name="attemptId" value={a.id} />
              <div>
                <SubmitButton size="sm" pendingText="Analysing…">
                  Analyse my mistakes
                </SubmitButton>
              </div>
            </ActionForm>
          )}
        </Card>
      )}

      <ol className="flex flex-col gap-3">
        {rows.map((r, i) => (
          <li key={r.question_id}>
            <Card className={cx("p-4 sm:p-5", r.is_correct === true && "border-ok/30", r.is_correct === false && "border-bad/30")}>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-faint">Question {i + 1}</span>
                {r.is_correct === true && Number(r.score) >= 1 && (
                  <Badge tone="ok">
                    <Check className="size-3" /> Correct
                  </Badge>
                )}
                {r.is_correct === true && Number(r.score) < 1 && <Badge tone="warn">Partly correct ({Math.round(Number(r.score) * 100)}%)</Badge>}
                {r.is_correct === false && (
                  <Badge tone="bad">
                    <X className="size-3" /> Incorrect
                  </Badge>
                )}
                {r.needs_review && <Badge tone="warn">Needs your review</Badge>}
                {r.topic_name && <Badge>{r.topic_name}</Badge>}
                {r.verification === "verified" && <Badge tone="ok" title={r.verification_note ?? ""}>Answer key re-checked</Badge>}
                {r.verification === "mismatch" && <Badge tone="warn" title={r.verification_note ?? ""}>Answer key may be wrong</Badge>}
                {r.error_category && <Badge tone="info">{MISTAKE_LABELS[r.error_category] ?? r.error_category}</Badge>}
              </div>
              <Markdown>{r.prompt}</Markdown>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <div className="rounded-lg bg-raised/60 p-3">
                  <dt className="text-xs text-faint">Your answer</dt>
                  <dd className="mt-1 whitespace-pre-wrap text-ivory">{describeResponse(r.qtype, r.response, r.choices)}</dd>
                </div>
                <div className="rounded-lg bg-raised/60 p-3">
                  <dt className="text-xs text-faint">Correct answer</dt>
                  <dd className="mt-1 text-ivory">
                    <Markdown className="prose-yx">{describeAnswer(r.qtype, r.answer, r.choices)}</Markdown>
                  </dd>
                </div>
              </dl>
              {r.feedback && <p className="mt-3 whitespace-pre-line text-sm text-muted">{r.feedback}</p>}
              {r.verification === "mismatch" && <p className="mt-2 text-xs text-warn">{r.verification_note}</p>}
              {r.answer_id && (r.needs_review || r.qtype === "short_answer" || r.qtype === "multi_step" || r.qtype === "formula") && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-faint">{r.needs_review ? "Compare with the solution, then mark it:" : "Disagree with the grade?"}</span>
                  <form action={markAnswerAction}>
                    <input type="hidden" name="answerId" value={r.answer_id} />
                    <input type="hidden" name="correct" value="true" />
                    <SubmitButton size="sm" variant="secondary">
                      I was right
                    </SubmitButton>
                  </form>
                  <form action={markAnswerAction}>
                    <input type="hidden" name="answerId" value={r.answer_id} />
                    <input type="hidden" name="correct" value="false" />
                    <SubmitButton size="sm" variant="ghost">
                      I was wrong
                    </SubmitButton>
                  </form>
                </div>
              )}
              {showSolutions && r.solution_md && (
                <details className="mt-3" open={r.is_correct === false}>
                  <summary className="cursor-pointer text-sm text-gold">Worked solution</summary>
                  <div className="mt-2 border-l border-gold/40 pl-4">
                    <Markdown>{r.solution_md}</Markdown>
                  </div>
                </details>
              )}
            </Card>
          </li>
        ))}
      </ol>
    </>
  );
}
