"use client";
import { useActionState, useState } from "react";
import { generateFlashcardsAction, generateQuizAction, generateSummaryAction } from "@/app/actions/generate";
import { Badge, Field, Input, Select, Textarea, cx } from "./ui";
import { FormMessage, SubmitButton } from "./client";

type Mat = { id: string; title: string; kind: string; ready: boolean; reason: string | null; pages: number; topic: string | null };
type Opt = { id: string; name: string };

const KINDS = [
  { key: "summary", label: "Summary / reviewer" },
  { key: "quiz", label: "Quiz" },
  { key: "flashcards", label: "Flashcards" },
] as const;

export function GenerateForm({
  subjectId,
  materials,
  topics,
  summaries,
  preselected,
  initialKind,
  modes,
  aiReady,
  maxSourceChars,
}: {
  subjectId: string;
  materials: Mat[];
  topics: Opt[];
  summaries: Opt[];
  preselected: string[];
  initialKind: string;
  modes: { key: string; label: string; hint: string }[];
  aiReady: boolean;
  maxSourceChars: number;
}) {
  const [kind, setKind] = useState<string>(KINDS.some((k) => k.key === initialKind) ? initialKind : "summary");
  const [selected, setSelected] = useState<string[]>(preselected.filter((id) => materials.some((m) => m.id === id && m.ready)));
  const [summaryState, summaryAction] = useActionState(generateSummaryAction, null);
  const [quizState, quizAction] = useActionState(generateQuizAction, null);
  const [cardState, cardAction] = useActionState(generateFlashcardsAction, null);
  const action = kind === "summary" ? summaryAction : kind === "quiz" ? quizAction : cardAction;
  const state = kind === "summary" ? summaryState : kind === "quiz" ? quizState : cardState;
  const single = selected.length === 1 ? materials.find((m) => m.id === selected[0]) : null;

  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="subjectId" value={subjectId} />
      <div role="tablist" aria-label="What to generate" className="flex flex-wrap gap-2">
        {KINDS.map((k) => (
          <button
            key={k.key}
            type="button"
            role="tab"
            aria-selected={kind === k.key}
            onClick={() => setKind(k.key)}
            className={cx(
              "rounded-lg border px-3 py-2 text-sm transition-colors",
              kind === k.key ? "border-gold/60 bg-gold/10 text-ivory" : "border-line text-muted hover:text-ivory",
            )}
          >
            {k.label}
          </button>
        ))}
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-xs font-medium text-muted">Source materials (up to 10)</legend>
        {materials.length === 0 && <p className="text-sm text-muted">This subject has no materials yet. You can still generate from general course knowledge, clearly labelled as not source-based.</p>}
        <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-lg border border-line">
          {materials.map((m) => (
            <li key={m.id}>
              <label className={cx("flex items-start gap-3 px-3 py-2.5 text-sm", m.ready ? "cursor-pointer hover:bg-raised/50" : "opacity-60")}>
                <input
                  type="checkbox"
                  name="materialIds"
                  value={m.id}
                  disabled={!m.ready}
                  checked={selected.includes(m.id)}
                  onChange={(e) => setSelected((s) => (e.target.checked ? [...s, m.id].slice(0, 10) : s.filter((x) => x !== m.id)))}
                  className="mt-1 accent-[#D6B36A]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ivory">{m.title}</span>
                  <span className="text-xs text-faint">
                    {m.ready ? `${m.pages} part${m.pages === 1 ? "" : "s"}${m.topic ? ` · ${m.topic}` : ""}` : m.reason}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        {kind !== "summary" && summaries.length > 0 && (
          <Field label="…or use a saved summary as the source" htmlFor="g-summary">
            <Select id="g-summary" name="summaryId" defaultValue="">
              <option value="">None</option>
              {summaries.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {single && single.pages > 1 && (
          <div className="grid grid-cols-2 gap-3 sm:max-w-sm">
            <Field label="From part / page" htmlFor="g-from">
              <Input id="g-from" name="pageFrom" type="number" min={1} max={single.pages} placeholder="1" />
            </Field>
            <Field label="To part / page" htmlFor="g-to">
              <Input id="g-to" name="pageTo" type="number" min={1} max={single.pages} placeholder={String(single.pages)} />
            </Field>
          </div>
        )}
        <p className="text-xs text-faint">
          Long sources are processed in parts (up to about {Math.round(maxSourceChars / 1000)}k characters each). If anything is left out, the result says exactly which pages were used.
        </p>
      </fieldset>

      <Field label="Topic (optional)" htmlFor="g-topic">
        <Select id="g-topic" name="topicId" defaultValue="">
          <option value="">Whole subject</option>
          {topics.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </Field>

      {kind === "summary" && (
        <>
          <fieldset>
            <legend className="mb-2 text-xs font-medium text-muted">Summary mode</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {modes.map((m, i) => (
                <label key={m.key} className="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-3 text-sm has-[:checked]:border-gold/60 has-[:checked]:bg-gold/5">
                  <input type="radio" name="mode" value={m.key} defaultChecked={i === 1} className="mt-1 accent-[#D6B36A]" />
                  <span>
                    <span className="block text-ivory">{m.label}</span>
                    <span className="text-xs text-faint">{m.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <Field label="Extra instructions (optional)" htmlFor="g-ins">
            <Textarea id="g-ins" name="instructions" rows={2} maxLength={1000} placeholder="e.g. Focus on gradient series and include peso examples" />
          </Field>
        </>
      )}

      {kind === "quiz" && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Number of questions" htmlFor="q-count">
              <Input id="q-count" name="count" type="number" min={1} max={30} defaultValue={8} required />
            </Field>
            <Field label="Difficulty" htmlFor="q-diff">
              <Select id="q-diff" name="difficulty" defaultValue="mixed">
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
                <option value="mixed">Mixed</option>
              </Select>
            </Field>
            <Field label="Time limit in minutes (optional)" htmlFor="q-time">
              <Input id="q-time" name="timeLimit" type="number" min={1} max={300} placeholder="None" />
            </Field>
          </div>
          <fieldset>
            <legend className="mb-2 text-xs font-medium text-muted">Question types</legend>
            <div className="flex flex-wrap gap-2">
              {[
                ["multiple_choice", "Multiple choice"],
                ["true_false", "True or false"],
                ["short_answer", "Short answer"],
                ["numerical", "Numerical"],
                ["formula", "Formula application"],
                ["multi_step", "Multi-step problems"],
              ].map(([v, l], i) => (
                <label key={v} className="flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm has-[:checked]:border-gold/60">
                  <input type="checkbox" name="types" value={v} defaultChecked={i === 0 || i === 3} className="accent-[#D6B36A]" />
                  {l}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Feedback" htmlFor="q-fb">
              <Select id="q-fb" name="feedback" defaultValue="after">
                <option value="after">After I submit</option>
                <option value="immediate">Right after each question</option>
              </Select>
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm text-ivory">
              <input type="checkbox" name="includeSolutions" defaultChecked className="accent-[#D6B36A]" /> Show detailed solutions in results
            </label>
          </div>
          <Field label="Focus topics (optional)" htmlFor="q-topics">
            <Input id="q-topics" name="topics" maxLength={500} placeholder="e.g. effective interest rate, annuities" />
          </Field>
          <Field label="Custom instructions (optional)" htmlFor="q-ins">
            <Textarea id="q-ins" name="instructions" rows={2} maxLength={1000} placeholder="e.g. Board-exam style, use peso amounts" />
          </Field>
        </>
      )}

      {kind === "flashcards" && (
        <Field label="Number of cards" htmlFor="f-count">
          <Input id="f-count" name="count" type="number" min={3} max={60} defaultValue={15} className="sm:w-40" />
        </Field>
      )}

      <FormMessage state={state} />
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton disabled={!aiReady} pendingText="Generating… this can take up to a minute">
          Generate {kind === "summary" ? "summary" : kind === "quiz" ? "quiz" : "flashcards"}
        </SubmitButton>
        {!aiReady && <Badge tone="warn">AI is not configured on this server</Badge>}
        {selected.length > 0 && <span className="text-xs text-faint">{selected.length} source{selected.length === 1 ? "" : "s"} selected</span>}
      </div>
    </form>
  );
}
