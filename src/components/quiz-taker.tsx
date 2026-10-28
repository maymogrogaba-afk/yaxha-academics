"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { checkOne, submitAttemptAction } from "@/app/actions/quizzes";
import { Markdown } from "./markdown";
import { Badge, Button, Card, Input, ProgressBar, Textarea, cx } from "./ui";

type Q = { id: string; qtype: string; prompt: string; choices: string[] | null; topic_name: string | null; position: number };
type Check = { isCorrect?: boolean | null; feedback?: string; solution?: string; correct?: string; pending?: boolean; error?: string };

export function QuizTaker({
  attemptId,
  quizId,
  questions,
  mode,
  deadline,
  immediate,
}: {
  attemptId: string;
  quizId: string;
  questions: Q[];
  mode: string;
  deadline: number | null;
  immediate: boolean;
}) {
  const router = useRouter();
  const storageKey = `yx-attempt-${attemptId}`;
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [index, setIndex] = useState(0);
  const [checks, setChecks] = useState<Record<string, Check>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const submitted = useRef(false);

  // Restore an unsent draft (kept only in this browser until submission).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) setAnswers(JSON.parse(saved));
    } catch {}
  }, [storageKey]);
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(answers));
    } catch {}
  }, [answers, storageKey]);

  const submit = useCallback(
    async (force = false) => {
      if (submitted.current) return;
      const unanswered = questions.filter((q) => !String(answers[q.id] ?? "").trim()).length;
      if (!force && !window.confirm(unanswered ? `${unanswered} question${unanswered === 1 ? " is" : "s are"} unanswered. Submit anyway?` : "Submit your answers?")) return;
      submitted.current = true;
      setSubmitting(true);
      setError(null);
      const res = await submitAttemptAction(attemptId, answers);
      if ("error" in res && res.error) {
        submitted.current = false;
        setSubmitting(false);
        setError(res.error);
        return;
      }
      try {
        localStorage.removeItem(storageKey);
      } catch {}
      router.push(`/attempts/${attemptId}`);
    },
    [answers, attemptId, questions, router, storageKey],
  );

  useEffect(() => {
    if (!deadline) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [deadline]);
  const remaining = deadline ? Math.max(0, Math.floor((deadline - now) / 1000)) : null;
  useEffect(() => {
    if (remaining === 0) submit(true);
  }, [remaining, submit]);

  const q = questions[index];
  const answered = useMemo(() => questions.filter((x) => String(answers[x.id] ?? "").trim()).length, [answers, questions]);
  const set = (v: string) => setAnswers((a) => ({ ...a, [q.id]: v }));
  const check = checks[q.id];

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex items-center gap-3 text-xs text-muted">
          <span className="whitespace-nowrap tabular-nums">
            Question {index + 1} of {questions.length}
          </span>
          <ProgressBar value={answered / questions.length} label="Answered" />
          {remaining !== null && (
            <span className={cx("flex items-center gap-1 whitespace-nowrap tabular-nums", remaining < 60 ? "text-bad" : "text-ivory")} aria-live="polite">
              <Clock className="size-3.5" /> {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}
            </span>
          )}
        </div>

        <Card className="p-5 sm:p-6">
          <div className="mb-3 flex flex-wrap gap-1.5">
            {q.topic_name && <Badge>{q.topic_name}</Badge>}
            <Badge tone="neutral">{q.qtype.replace("_", " ")}</Badge>
          </div>
          <Markdown>{q.prompt}</Markdown>
          <div className="mt-5">
            {q.qtype === "multiple_choice" && q.choices ? (
              <fieldset className="flex flex-col gap-2">
                <legend className="sr-only">Choices</legend>
                {q.choices.map((c, i) => (
                  <label
                    key={i}
                    className={cx(
                      "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors",
                      answers[q.id] === String(i) ? "border-gold/60 bg-gold/5" : "border-line hover:border-line-strong",
                    )}
                  >
                    <input type="radio" name={`q-${q.id}`} checked={answers[q.id] === String(i)} onChange={() => set(String(i))} className="mt-1 accent-[#D6B36A]" />
                    <span className="font-medium text-faint">{String.fromCharCode(65 + i)}.</span>
                    <Markdown className="prose-yx min-w-0 flex-1">{c}</Markdown>
                  </label>
                ))}
              </fieldset>
            ) : q.qtype === "true_false" ? (
              <div className="flex gap-2">
                {["true", "false"].map((v) => (
                  <Button key={v} variant={answers[q.id] === v ? "primary" : "secondary"} onClick={() => set(v)} aria-pressed={answers[q.id] === v}>
                    {v === "true" ? "True" : "False"}
                  </Button>
                ))}
              </div>
            ) : q.qtype === "numerical" ? (
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`a-${q.id}`} className="text-xs text-muted">
                  Your answer with units (e.g. 12,450.75 PHP or 3.2 m)
                </label>
                <Input id={`a-${q.id}`} value={answers[q.id] ?? ""} onChange={(e) => set(e.target.value)} inputMode="decimal" autoComplete="off" />
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`a-${q.id}`} className="text-xs text-muted">
                  Your answer{q.qtype !== "short_answer" ? " — show your key steps and the final answer with units" : ""}
                </label>
                <Textarea id={`a-${q.id}`} rows={q.qtype === "short_answer" ? 3 : 7} value={answers[q.id] ?? ""} onChange={(e) => set(e.target.value)} />
              </div>
            )}
          </div>

          {immediate && mode !== "exam" && (
            <div className="mt-4">
              {!check ? (
                <Button
                  size="sm"
                  disabled={!String(answers[q.id] ?? "").trim()}
                  onClick={async () => {
                    const qid = q.id;
                    setChecks((c) => ({ ...c, [qid]: { pending: true, feedback: "Checking…" } }));
                    const result = await checkOne(attemptId, qid, answers[qid] ?? "");
                    setChecks((c) => ({ ...c, [qid]: result }));
                  }}
                >
                  Check answer
                </Button>
              ) : (
                <div className={cx("rounded-lg border p-3 text-sm", check.isCorrect ? "border-ok/40" : check.isCorrect === false ? "border-bad/40" : "border-line")}>
                  <p className={check.isCorrect ? "text-ok" : check.isCorrect === false ? "text-bad" : "text-muted"}>{check.error ?? check.feedback}</p>
                  {check.correct && <p className="mt-1 text-muted">Answer: {check.correct}</p>}
                  {check.solution && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-gold">Worked solution</summary>
                      <Markdown className="prose-yx mt-2">{check.solution}</Markdown>
                    </details>
                  )}
                </div>
              )}
            </div>
          )}
        </Card>

        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
        <div className="flex items-center justify-between gap-2">
          <Button onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0}>
            <ChevronLeft className="size-4" /> Previous
          </Button>
          {index < questions.length - 1 ? (
            <Button onClick={() => setIndex((i) => i + 1)}>
              Next <ChevronRight className="size-4" />
            </Button>
          ) : (
            <Button variant="primary" onClick={() => submit()} disabled={submitting}>
              {submitting ? "Grading…" : "Submit"}
            </Button>
          )}
        </div>
      </div>

      <aside className="flex flex-col gap-3">
        <Card className="p-3">
          <div className="mb-2 text-xs text-muted">Questions</div>
          <ol className="grid grid-cols-6 gap-1.5 lg:grid-cols-5">
            {questions.map((x, i) => (
              <li key={x.id}>
                <button
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-label={`Question ${i + 1}${String(answers[x.id] ?? "").trim() ? ", answered" : ""}`}
                  aria-current={i === index}
                  className={cx(
                    "flex size-8 items-center justify-center rounded-md border text-xs tabular-nums",
                    i === index ? "border-gold text-ivory" : String(answers[x.id] ?? "").trim() ? "border-line bg-raised text-ivory" : "border-line text-faint",
                  )}
                >
                  {i + 1}
                </button>
              </li>
            ))}
          </ol>
        </Card>
        <Button variant="primary" onClick={() => submit()} disabled={submitting}>
          {submitting ? "Grading…" : `Submit (${answered}/${questions.length})`}
        </Button>
        <a href={`/quizzes/${quizId}`} className="text-center text-xs text-faint hover:text-ivory">
          Leave and continue later
        </a>
      </aside>
    </div>
  );
}
