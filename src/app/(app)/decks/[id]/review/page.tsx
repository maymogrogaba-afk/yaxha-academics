import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { isUuid } from "@/lib/data";
import { EmptyState, ButtonLink, PageHeader } from "@/components/ui";
import { Reviewer } from "@/components/reviewer";

export const metadata = { title: "Review flashcards" };

export default async function ReviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ all?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const all = (await searchParams).all === "1";
  if (!isUuid(id)) notFound();
  const data = await withUser(user.id, async (tx) => {
    const [deck] = await tx`select id, name, subject_id from flashcard_decks where id = ${id}`;
    if (!deck) return null;
    const cards = await tx`select id, front, back, topic_name, source_ref from flashcards
      where deck_id = ${id} ${all ? tx`` : tx`and due_at <= now()`} order by due_at limit 100`;
    return { deck, cards };
  });
  if (!data) notFound();
  return (
    <>
      <PageHeader
        eyebrow={<Link href={`/decks/${id}`} className="hover:text-ivory">Flashcards</Link>}
        title={data.deck.name}
        description={all ? "Reviewing every card in this deck." : "Cards due today, chosen by spaced repetition."}
      />
      {data.cards.length === 0 ? (
        <EmptyState title="Nothing is due right now" action={<ButtonLink href={`/decks/${id}/review?all=1`}>Review all cards anyway</ButtonLink>}>
          Cards come back when they are due. Reviewing early still records your answers.
        </EmptyState>
      ) : (
        <Reviewer cards={data.cards.map((c) => ({ id: c.id, front: c.front, back: c.back, topic_name: c.topic_name, source_ref: c.source_ref }))} backHref={`/decks/${id}`} />
      )}
    </>
  );
}
