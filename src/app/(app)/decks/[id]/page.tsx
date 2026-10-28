import Link from "next/link";
import { notFound } from "next/navigation";
import { Search, Trash2 } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { isUuid } from "@/lib/data";
import { Badge, ButtonLink, Card, EmptyState, Field, Input, PageHeader, Textarea } from "@/components/ui";
import { Dialog, SubmitButton } from "@/components/client";
import { ActionForm } from "@/components/action-form";
import { Markdown } from "@/components/markdown";
import { addCard, deleteCard, deleteDeck, renameDeck, updateCard } from "@/app/actions/flashcards";

export const metadata = { title: "Flashcards" };

export default async function DeckPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const q = ((await searchParams).q ?? "").trim().slice(0, 100);
  if (!isUuid(id)) notFound();
  const data = await withUser(user.id, async (tx) => {
    const [deck] = await tx`select d.*, s.display_name as subject_name from flashcard_decks d join subjects s on s.id = d.subject_id where d.id = ${id}`;
    if (!deck) return null;
    const cards = await tx`
      select c.*, m.title as source_title from flashcards c left join materials m on m.id = c.source_material_id
      where c.deck_id = ${id} ${q ? tx`and (c.front ilike ${"%" + q + "%"} or c.back ilike ${"%" + q + "%"} or c.topic_name ilike ${"%" + q + "%"})` : tx``}
      order by c.created_at`;
    const [{ due }] = await tx`select count(*)::int as due from flashcards where deck_id = ${id} and due_at <= now()`;
    return { deck, cards, due: due as number };
  });
  if (!data) notFound();
  const { deck, cards, due } = data;
  return (
    <>
      <PageHeader
        eyebrow={<Link href={`/subjects/${deck.subject_id}?tab=flashcards`} className="hover:text-ivory">{deck.subject_name}</Link>}
        title={deck.name}
        description={`${cards.length} card${cards.length === 1 ? "" : "s"}${q ? " matching" : ""} · ${due} due now`}
        actions={
          <>
            <Dialog title="Rename deck" trigger="Rename">
              <ActionForm action={renameDeck}>
                <input type="hidden" name="id" value={deck.id} />
                <Input name="name" defaultValue={deck.name} aria-label="Deck name" maxLength={160} required />
                <SubmitButton>Save</SubmitButton>
              </ActionForm>
            </Dialog>
            <form action={deleteDeck}>
              <input type="hidden" name="id" value={deck.id} />
              <SubmitButton variant="ghost" size="sm" confirm="Delete this deck and its review history?">
                Delete deck
              </SubmitButton>
            </form>
            <ButtonLink href={`/decks/${deck.id}/review`} variant="primary" size="sm">
              {due ? `Review ${due} due` : "Review all"}
            </ButtonLink>
          </>
        }
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <form method="get" className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
          <Input name="q" defaultValue={q} placeholder="Search cards…" aria-label="Search cards" className="pl-9" />
        </form>
        <Dialog title="Add a card" wide trigger="Add card">
          <ActionForm action={addCard} resetOnSuccess>
            <input type="hidden" name="deckId" value={deck.id} />
            <Field label="Front (question)" htmlFor="c-front">
              <Textarea id="c-front" name="front" rows={3} required />
            </Field>
            <Field label="Back (answer)" htmlFor="c-back" hint="LaTeX like $F = ma$ is supported.">
              <Textarea id="c-back" name="back" rows={4} required />
            </Field>
            <Field label="Topic (optional)" htmlFor="c-topic">
              <Input id="c-topic" name="topic" maxLength={200} />
            </Field>
            <SubmitButton>Add card</SubmitButton>
          </ActionForm>
        </Dialog>
      </div>
      {cards.length === 0 ? (
        <EmptyState title={q ? "No cards match" : "This deck is empty"}>Add cards yourself, or generate them from a material.</EmptyState>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {cards.map((c) => (
            <li key={c.id}>
              <Card className="flex h-full flex-col p-4">
                <Markdown className="prose-yx font-medium">{c.front}</Markdown>
                <div className="my-3 border-t border-line" />
                <Markdown className="prose-yx text-sm text-muted">{c.back}</Markdown>
                <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-3 text-xs text-faint">
                  {c.topic_name && <Badge>{c.topic_name}</Badge>}
                  {c.source_title && (
                    <Link href={`/materials/${c.source_material_id}`} className="hover:text-ivory">
                      Source: {c.source_title}
                      {c.source_ref ? ` (${c.source_ref})` : ""}
                    </Link>
                  )}
                  <span className="ml-auto">{c.repetitions > 0 ? `next in ${c.interval_days} d` : "new"}</span>
                  <Dialog title="Edit card" wide trigger="Edit" triggerClassName="text-xs text-muted hover:text-ivory">
                    <ActionForm action={updateCard}>
                      <input type="hidden" name="id" value={c.id} />
                      <Field label="Front" htmlFor={`f-${c.id}`}>
                        <Textarea id={`f-${c.id}`} name="front" rows={3} defaultValue={c.front} required />
                      </Field>
                      <Field label="Back" htmlFor={`b-${c.id}`}>
                        <Textarea id={`b-${c.id}`} name="back" rows={5} defaultValue={c.back} required />
                      </Field>
                      <SubmitButton>Save</SubmitButton>
                    </ActionForm>
                  </Dialog>
                  <form action={deleteCard}>
                    <input type="hidden" name="id" value={c.id} />
                    <SubmitButton variant="ghost" size="sm" confirm="Delete this card?">
                      <Trash2 className="size-3.5" />
                      <span className="sr-only">Delete card</span>
                    </SubmitButton>
                  </form>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
