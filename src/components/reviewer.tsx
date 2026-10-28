"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { reviewCard } from "@/app/actions/flashcards";
import { Markdown } from "./markdown";
import { Button, Card, ProgressBar, buttonClass } from "./ui";

type CardData = { id: string; front: string; back: string; topic_name: string | null; source_ref: string | null };

const RATINGS = [
  { r: 1, label: "Forgot", hint: "again soon", variant: "danger" as const },
  { r: 2, label: "Hard", hint: "remembered with effort", variant: "secondary" as const },
  { r: 3, label: "Good", hint: "remembered", variant: "secondary" as const },
  { r: 4, label: "Easy", hint: "instant", variant: "primary" as const },
];

export function Reviewer({ cards, backHref }: { cards: CardData[]; backHref: string }) {
  const [queue, setQueue] = useState(cards);
  const [revealed, setRevealed] = useState(false);
  const [done, setDone] = useState(0);
  const [again, setAgain] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const card = queue[0];

  if (!card) {
    return (
      <Card className="p-8 text-center">
        <h2 className="text-lg font-semibold">Review complete</h2>
        <p className="mt-2 text-sm text-muted">
          {done} review{done === 1 ? "" : "s"} recorded{again ? `, ${again} marked as forgotten (they come back soon)` : ""}.
        </p>
        <Link href={backHref} className={buttonClass("primary", "md", "mt-6")}>
          Back to deck
        </Link>
      </Card>
    );
  }

  function rate(r: 1 | 2 | 3 | 4) {
    setError(null);
    start(async () => {
      try {
        await reviewCard(card.id, r);
        setDone((d) => d + 1);
        if (r === 1) setAgain((a) => a + 1);
        // Forgotten cards go to the back of this session's queue once more.
        setQueue((q) => (r === 1 ? [...q.slice(1), q[0]] : q.slice(1)));
        setRevealed(false);
      } catch {
        setError("Could not save this review. Check your connection and try again.");
      }
    });
  }

  const total = cards.length;
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div className="flex items-center gap-3 text-xs text-muted">
        <span className="tabular-nums">
          {Math.min(done, total)} / {total}
        </span>
        <ProgressBar value={Math.min(done, total) / total} label="Review progress" />
      </div>
      <Card className="flex min-h-72 flex-col p-6">
        {card.topic_name && <div className="mb-3 text-xs uppercase tracking-wider text-faint">{card.topic_name}</div>}
        <Markdown className="prose-yx text-lg">{card.front}</Markdown>
        {revealed && (
          <>
            <div className="my-5 border-t border-line" />
            <Markdown>{card.back}</Markdown>
            {card.source_ref && <p className="mt-3 text-xs text-faint">Source: {card.source_ref}</p>}
          </>
        )}
      </Card>
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      {!revealed ? (
        <Button variant="primary" onClick={() => setRevealed(true)} autoFocus>
          Reveal answer
        </Button>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {RATINGS.map((x) => (
            <Button key={x.r} variant={x.variant} disabled={pending} onClick={() => rate(x.r as 1 | 2 | 3 | 4)} className="h-auto flex-col py-2">
              <span>{x.label}</span>
              <span className="text-[11px] font-normal opacity-70">{x.hint}</span>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
