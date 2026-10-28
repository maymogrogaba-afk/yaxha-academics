"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { scheduleCard, type Rating } from "@/lib/study/srs";
import type { FormState } from "./auth";

const id = z.string().uuid();
const text = z.string().trim().min(1, "Both sides need text.").max(5000);

export async function createDeck(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = z.object({ subjectId: id, name: z.string().trim().min(1).max(160) }).safeParse({ subjectId: form.get("subjectId"), name: form.get("name") });
  if (!parsed.success) return { error: "Enter a deck name." };
  const [d] = await withUser(user.id, (tx) => tx`insert into flashcard_decks (user_id, subject_id, name) values (${user.id}, ${parsed.data.subjectId}, ${parsed.data.name}) returning id`);
  redirect(`/decks/${d.id}`);
}

export async function renameDeck(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = z.object({ id, name: z.string().trim().min(1).max(160) }).safeParse({ id: form.get("id"), name: form.get("name") });
  if (!parsed.success) return { error: "Enter a deck name." };
  await withUser(user.id, (tx) => tx`update flashcard_decks set name = ${parsed.data.name} where id = ${parsed.data.id}`);
  revalidatePath(`/decks/${parsed.data.id}`);
  return { ok: "Renamed." };
}

export async function deleteDeck(form: FormData) {
  const user = await requireUser();
  const did = id.parse(form.get("id"));
  const [d] = await withUser(user.id, (tx) => tx`delete from flashcard_decks where id = ${did} returning subject_id`);
  redirect(d ? `/subjects/${d.subject_id}?tab=flashcards` : "/subjects");
}

export async function addCard(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = z.object({ deckId: id, front: text, back: text, topic: z.string().max(200).optional() })
    .safeParse({ deckId: form.get("deckId"), front: form.get("front"), back: form.get("back"), topic: form.get("topic") || undefined });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  await withUser(user.id, (tx) => tx`insert into flashcards (user_id, deck_id, front, back, topic_name)
    values (${user.id}, ${parsed.data.deckId}, ${parsed.data.front}, ${parsed.data.back}, ${parsed.data.topic ?? null})`);
  revalidatePath(`/decks/${parsed.data.deckId}`);
  return { ok: "Card added." };
}

export async function updateCard(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = z.object({ id, front: text, back: text }).safeParse({ id: form.get("id"), front: form.get("front"), back: form.get("back") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const [c] = await withUser(user.id, (tx) => tx`update flashcards set front = ${parsed.data.front}, back = ${parsed.data.back} where id = ${parsed.data.id} returning deck_id`);
  if (c) revalidatePath(`/decks/${c.deck_id}`);
  return { ok: "Saved." };
}

export async function deleteCard(form: FormData) {
  const user = await requireUser();
  const cid = id.parse(form.get("id"));
  const [c] = await withUser(user.id, (tx) => tx`delete from flashcards where id = ${cid} returning deck_id`);
  if (c) revalidatePath(`/decks/${c.deck_id}`);
}

/** Records a review and schedules the card's next appearance. */
export async function reviewCard(cardId: string, rating: Rating) {
  const user = await requireUser();
  id.parse(cardId);
  if (![1, 2, 3, 4].includes(rating)) throw new Error("Invalid rating");
  return withUser(user.id, async (tx) => {
    const [c] = await tx`select ease, interval_days, repetitions, lapses from flashcards where id = ${cardId}`;
    if (!c) throw new Error("Card not found");
    const next = scheduleCard({ ease: Number(c.ease), interval: c.interval_days, repetitions: c.repetitions, lapses: c.lapses }, rating);
    await tx`update flashcards set ease = ${next.ease}, interval_days = ${next.interval}, repetitions = ${next.repetitions},
             lapses = ${next.lapses}, due_at = ${next.dueAt} where id = ${cardId}`;
    await tx`insert into flashcard_reviews (user_id, card_id, rating, prev_interval, new_interval)
             values (${user.id}, ${cardId}, ${rating}, ${c.interval_days}, ${next.interval})`;
    return { interval: next.interval };
  });
}
