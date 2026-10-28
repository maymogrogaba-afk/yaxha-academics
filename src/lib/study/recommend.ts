// "What should I study next?" — a simple, explainable scoring system.
// Every reason shown to the user is built only from data that was actually recorded.
import { daysBetween } from "./dates";

export type RecInput = {
  today: string;
  now: Date;
  sessionMinutes: number;
  assignments: { id: string; title: string; subjectId: string; subjectName: string; dueDate: string | null; completed: boolean }[];
  exams: { id: string; title: string; subjectId: string; subjectName: string; examDate: string; topicIds: string[] }[];
  topics: { id: string; name: string; subjectId: string; subjectName: string; importance: number }[];
  mastery: {
    topicId: string;
    attempts: number;
    recentAccuracy: number | null;
    lastPracticedAt: Date | null;
    nextReviewAt: Date | null;
    mistakeCounts: Record<string, number>;
  }[];
  dueCards: { subjectId: string; subjectName: string; deckId: string; count: number }[];
};

export type Recommendation = {
  key: string;
  kind: "assignment" | "exam_topic" | "review" | "flashcards" | "weak_topic";
  title: string;
  subjectId: string;
  subjectName: string;
  topicId?: string;
  minutes: number;
  reason: string;
  href: string;
  score: number;
};

export const MISTAKE_LABELS: Record<string, string> = {
  formula_selection: "choosing the wrong formula",
  algebra: "algebra",
  unit_conversion: "unit conversion",
  conceptual: "conceptual understanding",
  missing_assumption: "missing assumptions",
  interpretation: "interpreting the problem",
  arithmetic: "arithmetic",
  sequence: "calculation order",
};

function pct(x: number) {
  return `${Math.round(x * 100)}%`;
}

export function recommend(input: RecInput, limit = 5): Recommendation[] {
  const recs: Recommendation[] = [];
  const masteryBy = new Map(input.mastery.map((m) => [m.topicId, m]));
  const topicBy = new Map(input.topics.map((t) => [t.id, t]));

  // 1) Assignments due soon
  for (const a of input.assignments) {
    if (a.completed || !a.dueDate) continue;
    const d = daysBetween(input.today, a.dueDate);
    if (d < -3 || d > 7) continue;
    const when = d < 0 ? `was due ${-d} day${d === -1 ? "" : "s"} ago` : d === 0 ? "is due today" : `is due in ${d} day${d === 1 ? "" : "s"}`;
    recs.push({
      key: `a:${a.id}`,
      kind: "assignment",
      title: a.title,
      subjectId: a.subjectId,
      subjectName: a.subjectName,
      minutes: input.sessionMinutes,
      reason: `This assignment ${when}.`,
      href: `/subjects/${a.subjectId}?tab=assignments`,
      score: 100 - Math.max(d, 0) * 10,
    });
  }

  // 2) Topics covered by an upcoming exam
  const examTopicIds = new Set<string>();
  for (const e of input.exams) {
    const d = daysBetween(input.today, e.examDate);
    if (d < 0 || d > 21) continue;
    for (const tid of e.topicIds) {
      const t = topicBy.get(tid);
      if (!t) continue;
      examTopicIds.add(tid);
      const m = masteryBy.get(tid);
      let reason: string;
      let weakness: number;
      if (!m || m.attempts === 0) {
        reason = `"${e.title}" is in ${d} day${d === 1 ? "" : "s"} and no practice is recorded on this topic yet.`;
        weakness = 0.8;
      } else {
        const acc = m.recentAccuracy ?? 0;
        weakness = 1 - acc;
        reason = `"${e.title}" is in ${d} day${d === 1 ? "" : "s"}; your recent accuracy on this topic is ${pct(acc)} over ${m.attempts} question${m.attempts === 1 ? "" : "s"}.`;
        const top = topMistake(m.mistakeCounts);
        if (top) reason += ` Most recorded mistakes were in ${MISTAKE_LABELS[top.key] ?? top.key} (${top.count}).`;
      }
      recs.push({
        key: `e:${e.id}:${tid}`,
        kind: "exam_topic",
        title: t.name,
        subjectId: t.subjectId,
        subjectName: t.subjectName,
        topicId: tid,
        minutes: input.sessionMinutes,
        reason,
        href: `/study?subject=${t.subjectId}&topic=${tid}&mode=test`,
        score: 60 + weakness * 30 + (21 - d) * 1.5 + t.importance * 2,
      });
    }
  }

  // 3) Spaced review due, and 4) weak topics
  for (const m of input.mastery) {
    if (examTopicIds.has(m.topicId)) continue;
    const t = topicBy.get(m.topicId);
    if (!t || m.attempts === 0) continue;
    const acc = m.recentAccuracy ?? 0;
    if (m.nextReviewAt && m.nextReviewAt <= input.now) {
      const ago = m.lastPracticedAt ? Math.max(0, Math.round((input.now.getTime() - m.lastPracticedAt.getTime()) / 86_400_000)) : null;
      recs.push({
        key: `r:${m.topicId}`,
        kind: acc < 0.6 ? "weak_topic" : "review",
        title: t.name,
        subjectId: t.subjectId,
        subjectName: t.subjectName,
        topicId: t.id,
        minutes: Math.min(25, input.sessionMinutes),
        reason:
          (ago !== null ? `Last practiced ${ago === 0 ? "today" : ago === 1 ? "yesterday" : `${ago} days ago`}` : "Due for review") +
          ` with ${pct(acc)} recent accuracy, so it is due for spaced review.`,
        href: `/study?subject=${t.subjectId}&topic=${t.id}&mode=test`,
        score: 40 + (1 - acc) * 30 + t.importance * 2,
      });
    } else if (acc < 0.6 && m.attempts >= 3) {
      const top = topMistake(m.mistakeCounts);
      recs.push({
        key: `w:${m.topicId}`,
        kind: "weak_topic",
        title: t.name,
        subjectId: t.subjectId,
        subjectName: t.subjectName,
        topicId: t.id,
        minutes: input.sessionMinutes,
        reason:
          `Recent accuracy is ${pct(acc)} over ${m.attempts} questions` +
          (top ? `, with most recorded mistakes in ${MISTAKE_LABELS[top.key] ?? top.key}.` : "."),
        href: `/study?subject=${t.subjectId}&topic=${t.id}&mode=fix`,
        score: 35 + (1 - acc) * 30,
      });
    }
  }

  // 5) Flashcards due
  for (const c of input.dueCards) {
    if (c.count <= 0) continue;
    recs.push({
      key: `f:${c.deckId}`,
      kind: "flashcards",
      title: `${c.count} flashcard${c.count === 1 ? "" : "s"} due`,
      subjectId: c.subjectId,
      subjectName: c.subjectName,
      minutes: Math.min(30, Math.max(5, Math.round(c.count * 0.5))),
      reason: `${c.count} card${c.count === 1 ? " is" : "s are"} scheduled for review today by spaced repetition.`,
      href: `/decks/${c.deckId}/review`,
      score: 30 + Math.min(c.count, 40) * 0.5,
    });
  }

  return recs.sort((a, b) => b.score - a.score).slice(0, limit);
}

function topMistake(counts: Record<string, number>) {
  const entries = Object.entries(counts ?? {}).filter(([, n]) => n >= 2);
  if (!entries.length) return null;
  entries.sort((a, b) => b[1] - a[1]);
  return { key: entries[0][0], count: entries[0][1] };
}
