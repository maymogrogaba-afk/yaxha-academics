// Spaced repetition: the better you remember something, the longer until you see it again.

export type CardState = { ease: number; interval: number; repetitions: number; lapses: number };
export type Rating = 1 | 2 | 3 | 4; // 1 = forgot, 2 = hard, 3 = good, 4 = easy

/** A simplified SM-2 schedule. `interval` is in days; 0 means "again in a few minutes". */
export function scheduleCard(s: CardState, rating: Rating, now = new Date()) {
  let { ease, interval, repetitions, lapses } = s;
  if (rating === 1) {
    repetitions = 0;
    lapses += 1;
    interval = 0;
    ease = Math.max(1.3, ease - 0.2);
  } else if (rating === 2) {
    repetitions += 1;
    interval = Math.max(1, Math.round(interval * 1.2));
    ease = Math.max(1.3, ease - 0.15);
  } else {
    repetitions += 1;
    if (repetitions === 1) interval = 1;
    else if (repetitions === 2) interval = 3;
    else interval = Math.round(interval * ease);
    if (rating === 4) {
      interval = Math.round(interval * 1.3) || 1;
      ease = Math.min(3.0, ease + 0.15);
    }
  }
  interval = Math.min(interval, 180);
  const due = new Date(now.getTime() + (interval === 0 ? 10 * 60_000 : interval * 86_400_000));
  return { ease: Math.round(ease * 100) / 100, interval, repetitions, lapses, dueAt: due };
}

export type MasteryState = {
  attempts: number;
  correct: number;
  recentAccuracy: number | null;
  intervalDays: number;
  mistakeCounts: Record<string, number>;
};

/** Updates a topic's mastery after practice. `score` and `total` are for this practice round only. */
export function updateMastery(prev: MasteryState, score: number, total: number, mistakes: string[], now = new Date()) {
  const acc = total > 0 ? score / total : 0;
  const recent = prev.recentAccuracy === null ? acc : 0.6 * prev.recentAccuracy + 0.4 * acc;
  let interval: number;
  if (acc >= 0.85) interval = Math.min(30, Math.max(2, prev.intervalDays * 2));
  else if (acc >= 0.6) interval = Math.min(14, Math.max(2, Math.round(prev.intervalDays * 1.3)));
  else interval = 1;
  const mistakeCounts = { ...prev.mistakeCounts };
  for (const m of mistakes) mistakeCounts[m] = (mistakeCounts[m] ?? 0) + 1;
  return {
    attempts: prev.attempts + total,
    correct: prev.correct + score,
    recentAccuracy: Math.round(recent * 1000) / 1000,
    intervalDays: interval,
    nextReviewAt: new Date(now.getTime() + interval * 86_400_000),
    mistakeCounts,
  };
}
