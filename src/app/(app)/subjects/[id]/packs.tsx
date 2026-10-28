import Link from "next/link";
import type { Row } from "postgres";
import { Layers, ListChecks, Sparkles } from "lucide-react";
import { withUser } from "@/lib/db";
import { outdatedPackIds } from "@/lib/data";
import { SUMMARY_MODES } from "@/lib/ai/prompts";
import { formatDateTime } from "@/lib/study/dates";
import { Badge, ButtonLink, Card, EmptyState, Field, Input } from "@/components/ui";
import { Dialog, SubmitButton } from "@/components/client";
import { ActionForm } from "@/components/action-form";
import { createDeck } from "@/app/actions/flashcards";

function GenerateLink({ subjectId, kind, label }: { subjectId: string; kind: string; label: string }) {
  return (
    <ButtonLink href={`/generate?subject=${subjectId}&kind=${kind}`} variant="primary" size="sm">
      <Sparkles className="size-4" /> {label}
    </ButtonLink>
  );
}

export async function SummariesTab({ userId, subject, tz }: { userId: string; subject: Row; tz: string }) {
  const { rows, outdated } = await withUser(userId, async (tx) => ({
    rows: await tx`select s.id, s.title, s.mode, s.updated_at, s.edited, s.source_coverage, t.name as topic_name
                   from summaries s left join topics t on t.id = s.topic_id where s.subject_id = ${subject.id} order by s.updated_at desc`,
    outdated: await outdatedPackIds(tx, subject.id),
  }));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <GenerateLink subjectId={subject.id} kind="summary" label="Generate summary" />
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No summaries yet">Open a material and choose Generate Study Pack, or generate from several materials at once.</EmptyState>
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {rows.map((s) => (
              <li key={s.id}>
                <Link href={`/summaries/${s.id}`} className="flex flex-col gap-1 px-4 py-3 hover:bg-raised/40 sm:px-5">
                  <span className="text-sm text-ivory">{s.title}</span>
                  <span className="flex flex-wrap items-center gap-1.5 text-xs text-faint">
                    <Badge>{SUMMARY_MODES[s.mode as keyof typeof SUMMARY_MODES]?.label ?? s.mode}</Badge>
                    {s.topic_name && <span>{s.topic_name} ·</span>}
                    <span>{formatDateTime(s.updated_at, tz)}</span>
                    {s.edited && <Badge>Edited</Badge>}
                    {(s.source_coverage ?? []).some((c: { partial: boolean }) => c.partial) && <Badge tone="warn">Partial source</Badge>}
                    {outdated.has(s.id) && <Badge tone="warn">Source changed</Badge>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

export async function QuizzesTab({ userId, subject, tz }: { userId: string; subject: Row; tz: string }) {
  const { rows, outdated } = await withUser(userId, async (tx) => ({
    rows: await tx`
      select q.id, q.title, q.created_at, (select count(*)::int from quiz_questions x where x.quiz_id = q.id) as n,
        (select count(*)::int from quiz_attempts a where a.quiz_id = q.id and a.submitted_at is not null) as attempts,
        (select a.score / nullif(a.max_score, 0) from quiz_attempts a where a.quiz_id = q.id and a.submitted_at is not null order by a.submitted_at desc limit 1)::float as last_score
      from quizzes q where q.subject_id = ${subject.id} order by q.created_at desc`,
    outdated: await outdatedPackIds(tx, subject.id),
  }));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <GenerateLink subjectId={subject.id} kind="quiz" label="Generate quiz" />
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={<ListChecks className="size-6" />} title="No quizzes yet">
          Generate a quiz from your materials or summaries to start practising.
        </EmptyState>
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {rows.map((q) => (
              <li key={q.id}>
                <Link href={`/quizzes/${q.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-raised/40 sm:px-5">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-ivory">{q.title}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-faint">
                      {q.n} questions · {formatDateTime(q.created_at, tz)}
                      {outdated.has(q.id) && <Badge tone="warn">Source changed</Badge>}
                    </div>
                  </div>
                  <div className="text-right text-xs text-faint">
                    {q.attempts > 0 ? (
                      <>
                        <div className="text-sm font-medium tabular-nums text-ivory">{Math.round(q.last_score * 100)}%</div>
                        last of {q.attempts}
                      </>
                    ) : (
                      "Not taken"
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

export async function FlashcardsTab({ userId, subject }: { userId: string; subject: Row; tz: string }) {
  const rows = await withUser(userId, (tx) => tx`
    select d.id, d.name, (select count(*)::int from flashcards c where c.deck_id = d.id) as n,
      (select count(*)::int from flashcards c where c.deck_id = d.id and c.due_at <= now()) as due
    from flashcard_decks d where d.subject_id = ${subject.id} order by d.created_at desc`);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap justify-end gap-2">
        <Dialog title="New deck" trigger="New empty deck">
          <ActionForm action={createDeck}>
            <input type="hidden" name="subjectId" value={subject.id} />
            <Field label="Deck name" htmlFor="deck-name">
              <Input id="deck-name" name="name" required maxLength={160} />
            </Field>
            <SubmitButton>Create deck</SubmitButton>
          </ActionForm>
        </Dialog>
        <GenerateLink subjectId={subject.id} kind="flashcards" label="Generate flashcards" />
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={<Layers className="size-6" />} title="No flashcard decks yet">
          Generate cards from a material or summary, or make a deck and write your own.
        </EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((d) => (
            <li key={d.id}>
              <Card className="flex h-full flex-col p-4">
                <Link href={`/decks/${d.id}`} className="text-sm font-medium text-ivory hover:text-gold">
                  {d.name}
                </Link>
                <p className="mt-1 text-xs text-faint">
                  {d.n} cards · {d.due} due now
                </p>
                <div className="mt-auto flex gap-2 pt-4">
                  <ButtonLink href={`/decks/${d.id}/review`} size="sm" variant={d.due ? "primary" : "secondary"}>
                    Review{d.due ? ` ${d.due}` : ""}
                  </ButtonLink>
                  <ButtonLink href={`/decks/${d.id}`} size="sm" variant="ghost">
                    Edit
                  </ButtonLink>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
