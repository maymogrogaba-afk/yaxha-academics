"use client";
import { useActionState, useState } from "react";
import { createTutorSession } from "@/app/actions/tutor";
import { Field, Select, cx } from "./ui";
import { FormMessage, SubmitButton } from "./client";

type Subject = { id: string; name: string; topics: { id: string; name: string }[]; materials: { id: string; title: string }[] };

export function NewSessionForm({
  modes,
  subjects,
  initial,
  disabled,
}: {
  modes: { key: string; label: string; description: string }[];
  subjects: Subject[];
  initial: { mode?: string; subject?: string; topic?: string; material?: string };
  disabled: boolean;
}) {
  const [state, action] = useActionState(createTutorSession, null);
  const [mode, setMode] = useState(modes.some((m) => m.key === initial.mode) ? initial.mode! : "teach");
  const [subjectId, setSubjectId] = useState(subjects.some((s) => s.id === initial.subject) ? initial.subject! : subjects[0]?.id ?? "");
  const subject = subjects.find((s) => s.id === subjectId);
  return (
    <form action={action} className="flex flex-col gap-5">
      <fieldset>
        <legend className="mb-2 text-xs font-medium text-muted">How do you want to learn?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {modes.map((m) => (
            <label
              key={m.key}
              className={cx(
                "flex cursor-pointer flex-col rounded-lg border p-3 transition-colors",
                mode === m.key ? "border-gold/60 bg-gold/5" : "border-line hover:border-line-strong",
              )}
            >
              <input type="radio" name="mode" value={m.key} checked={mode === m.key} onChange={() => setMode(m.key)} className="sr-only" />
              <span className="text-sm font-medium text-ivory">{m.label}</span>
              <span className="mt-0.5 text-xs text-muted">{m.description}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Subject" htmlFor="ns-subject">
          <Select id="ns-subject" name="subjectId" value={subjectId} onChange={(e) => setSubjectId(e.target.value)} required>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Topic (optional)" htmlFor="ns-topic">
          <Select id="ns-topic" name="topicId" defaultValue={initial.topic ?? ""} key={`t-${subjectId}`}>
            <option value="">Any topic</option>
            {subject?.topics.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Use a material as context (optional)" htmlFor="ns-material">
          <Select id="ns-material" name="materialId" defaultValue={initial.material ?? ""} key={`m-${subjectId}`}>
            <option value="">None</option>
            {subject?.materials.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <FormMessage state={state} />
      <div>
        <SubmitButton disabled={disabled || !subjectId}>Start session</SubmitButton>
      </div>
    </form>
  );
}
