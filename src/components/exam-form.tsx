"use client";
import { useActionState, useState } from "react";
import { createExam } from "@/app/actions/exams";
import { Field, Input, Select, Textarea } from "./ui";
import { FormMessage, SubmitButton } from "./client";

type Subject = { id: string; name: string; topics: { id: string; name: string }[] };

const LEVELS = ["1 — very low", "2 — low", "3 — medium", "4 — high", "5 — very high"];

export function ExamForm({ subjects, initialSubject, defaultHours }: { subjects: Subject[]; initialSubject?: string; defaultHours: number }) {
  const [state, action] = useActionState(createExam, null);
  const [subjectId, setSubjectId] = useState(subjects.some((s) => s.id === initialSubject) ? initialSubject! : subjects[0]?.id ?? "");
  const subject = subjects.find((s) => s.id === subjectId);
  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Subject" htmlFor="ex-subject">
          <Select id="ex-subject" name="subjectId" value={subjectId} onChange={(e) => setSubjectId(e.target.value)} required>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Exam name" htmlFor="ex-title">
          <Input id="ex-title" name="title" placeholder="e.g. Midterm exam" required maxLength={160} />
        </Field>
        <Field label="Date and time" htmlFor="ex-at">
          <Input id="ex-at" name="examAt" type="datetime-local" required />
        </Field>
        <Field label="Study hours available per day" htmlFor="ex-hours">
          <Input id="ex-hours" name="hoursPerDay" type="number" step="0.25" min="0.25" max="16" defaultValue={defaultHours} required />
        </Field>
        <Field label="How difficult is this exam?" htmlFor="ex-diff">
          <Select id="ex-diff" name="difficulty" defaultValue="3">
            {LEVELS.map((l, i) => (
              <option key={l} value={i + 1}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="How confident do you feel now?" htmlFor="ex-conf">
          <Select id="ex-conf" name="confidence" defaultValue="3">
            {LEVELS.map((l, i) => (
              <option key={l} value={i + 1}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <fieldset>
        <legend className="mb-2 text-xs font-medium text-muted">Covered topics</legend>
        {subject && subject.topics.length > 0 ? (
          <div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto" key={subjectId}>
            {subject.topics.map((t) => (
              <label key={t.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-sm has-[:checked]:border-gold/60">
                <input type="checkbox" name="topicIds" value={t.id} className="accent-[#D6B36A]" /> {t.name}
              </label>
            ))}
          </div>
        ) : (
          <p className="text-xs text-faint">This subject has no topics yet. Type them below.</p>
        )}
        <div className="mt-3">
          <Field label="Add topics (one per line or comma-separated)" htmlFor="ex-new">
            <Textarea id="ex-new" name="newTopics" rows={2} placeholder="e.g. Exact equations, Integrating factors" />
          </Field>
        </div>
      </fieldset>
      <Field label="Days you cannot study (optional)" htmlFor="ex-unavail" hint="Dates as YYYY-MM-DD, separated by commas. Weekly study days come from Settings.">
        <Input id="ex-unavail" name="unavailable" placeholder="2026-11-01, 2026-11-02" />
      </Field>
      <FormMessage state={state} />
      <div>
        <SubmitButton pendingText="Building your plan…">Create exam and plan</SubmitButton>
      </div>
    </form>
  );
}
