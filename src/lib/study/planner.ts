// Builds an exam preparation schedule. Pure logic: given the same inputs it
// always produces the same plan, which makes it easy to test and to explain.
import { addDays, daysBetween, weekday } from "./dates";

export type PlanTopic = {
  id: string;
  name: string;
  difficulty: number; // 1..5
  confidence: number; // 1..5
  importance: number; // 1..5
  accuracy?: number | null; // 0..1 from quiz practice, if any
  practiced?: number; // number of questions answered so far
  doneMinutes?: number; // minutes already completed for this exam on this topic
};

export type PlanInput = {
  today: string; // YYYY-MM-DD in the user's time zone
  examDate: string; // YYYY-MM-DD
  minutesPerDay: number;
  sessionMinutes: number;
  availableWeekdays: number[]; // 0..6
  unavailableDates: string[];
  topics: PlanTopic[];
  examTitle: string;
};

export type PlannedTask = {
  date: string;
  topicId: string | null;
  kind: "learn" | "practice" | "review" | "mock_exam";
  minutes: number;
  title: string;
  reason: string;
  priority: number;
};

export type PlanResult = {
  tasks: PlannedTask[];
  warnings: string[];
  neededMinutes: number;
  availableMinutes: number;
  studyDays: string[];
};

/** How many minutes a topic deserves, before fitting the plan into the available time. */
export function topicNeed(t: PlanTopic): { minutes: number; why: string[] } {
  const why: string[] = [];
  let m = 90;
  m *= 0.6 + 0.2 * t.difficulty; // difficulty 1 → 0.8x, 5 → 1.6x
  m *= 1.4 - 0.2 * t.confidence; // confidence 1 → 1.2x, 5 → 0.4x
  m *= 0.6 + 0.2 * t.importance;
  if (t.difficulty >= 4) why.push("you rated it difficult");
  if (t.confidence <= 2) why.push("your confidence is low");
  if (t.importance >= 4) why.push("it is marked important");
  if (typeof t.accuracy === "number" && (t.practiced ?? 0) >= 3) {
    m *= 1.5 - t.accuracy; // 40% accuracy → 1.1x, 90% → 0.6x
    if (t.accuracy < 0.6) why.push(`your practice accuracy is ${Math.round(t.accuracy * 100)}%`);
  } else if (!t.practiced) {
    why.push("you have no practice recorded on it yet");
  }
  return { minutes: Math.max(30, Math.round(m / 5) * 5), why };
}

export function buildExamPlan(input: PlanInput): PlanResult {
  const warnings: string[] = [];
  const session = Math.max(15, Math.min(input.sessionMinutes, 120));
  const daysLeft = daysBetween(input.today, input.examDate);
  if (daysLeft <= 0) {
    return { tasks: [], warnings: ["The exam date is today or already past, so there is nothing left to schedule."], neededMinutes: 0, availableMinutes: 0, studyDays: [] };
  }
  if (input.topics.length === 0) warnings.push("No topics were selected. Add the covered topics to get topic-by-topic sessions.");
  if (input.minutesPerDay > 8 * 60) warnings.push("More than 8 study hours a day is rarely sustainable. Consider a lighter daily load.");

  const unavailable = new Set(input.unavailableDates);
  const studyDays: string[] = [];
  for (let i = 0; i < daysLeft; i++) {
    const d = addDays(input.today, i);
    if (unavailable.has(d)) continue;
    if (input.availableWeekdays.length && !input.availableWeekdays.includes(weekday(d))) continue;
    studyDays.push(d);
  }
  const capacity = new Map(studyDays.map((d) => [d, input.minutesPerDay]));
  const availableMinutes = studyDays.length * input.minutesPerDay;
  if (studyDays.length === 0) {
    warnings.push("There are no available study days before the exam. Remove some unavailable dates or add study days in Settings.");
    return { tasks: [], warnings, neededMinutes: 0, availableMinutes: 0, studyDays };
  }

  // Reserve the last study day (when there are at least 3) for a mock exam and light review.
  const tasks: PlannedTask[] = [];
  const mockDay = studyDays.length >= 3 ? studyDays[studyDays.length - 1] : null;
  if (mockDay) {
    const mockMin = Math.min(input.minutesPerDay, Math.max(45, session * 2));
    tasks.push({
      date: mockDay,
      topicId: null,
      kind: "mock_exam",
      minutes: mockMin,
      title: `Mock exam: ${input.examTitle}`,
      reason: "A timed run-through before the exam shows what still needs attention.",
      priority: 5,
    });
    capacity.set(mockDay, input.minutesPerDay - mockMin);
  }

  const needs = input.topics
    .map((t) => ({ t, ...topicNeed(t) }))
    .sort((a, b) => b.minutes - a.minutes);
  // 75% of each topic's time goes to learning and practice, 25% to spaced review later.
  const neededMinutes = needs.reduce((s, n) => s + Math.max(0, n.minutes - (n.t.doneMinutes ?? 0)), 0);
  const usable = [...capacity.values()].reduce((s, v) => s + v, 0);
  let scale = 1;
  if (neededMinutes > usable) {
    scale = usable / neededMinutes;
    warnings.push(
      `This plan needs about ${Math.round(neededMinutes / 60)} hours but only ${Math.round(usable / 60)} hours are available before the exam. ` +
        `Sessions were shortened to fit. Adding study hours or days would give each topic more time.`,
    );
  }

  type Chunk = { topic: PlanTopic; kind: "learn" | "practice" | "review"; minutes: number; why: string[] };
  const early: Chunk[][] = [];
  const late: Chunk[] = [];
  for (const n of needs) {
    const remainingNeed = Math.max(0, n.minutes - (n.t.doneMinutes ?? 0));
    if (remainingNeed < 15) continue; // already covered by completed sessions
    const total = Math.max(15, Math.round((remainingNeed * scale) / 5) * 5);
    const reviewMin = studyDays.length >= 2 ? Math.max(15, Math.round((total * 0.25) / 5) * 5) : 0;
    let main = total - reviewMin;
    const chunks: Chunk[] = [];
    let first = true;
    while (main > 0) {
      const m = Math.min(session, main);
      chunks.push({ topic: n.t, kind: first && (n.t.practiced ?? 0) === 0 ? "learn" : "practice", minutes: Math.max(15, m), why: n.why });
      first = false;
      main -= m;
    }
    early.push(chunks);
    if (reviewMin) late.push({ topic: n.t, kind: "review", minutes: reviewMin, why: n.why });
  }

  // Interleave topics round-robin so each day mixes topics rather than cramming one topic.
  const ordered: Chunk[] = [];
  for (let round = 0; early.some((c) => c.length > round); round++) {
    for (const c of early) if (c[round]) ordered.push(c[round]);
  }

  const daysForMain = studyDays.filter((d) => d !== mockDay);
  const reviewStart = Math.floor(daysForMain.length * (2 / 3));
  let dayIdx = 0;
  const place = (chunk: Chunk, startIdx: number) => {
    for (let i = startIdx; i < studyDays.length; i++) {
      const d = studyDays[i];
      const free = capacity.get(d) ?? 0;
      if (free >= Math.min(chunk.minutes, 15)) {
        const minutes = Math.min(chunk.minutes, free);
        capacity.set(d, free - minutes);
        const reason = buildReason(chunk.kind, chunk.why);
        tasks.push({
          date: d,
          topicId: chunk.topic.id,
          kind: chunk.kind,
          minutes,
          title: `${labelFor(chunk.kind)}: ${chunk.topic.name}`,
          reason,
          priority: Math.min(5, Math.max(1, Math.round(chunk.topic.importance * 0.5 + chunk.topic.difficulty * 0.5))),
        });
        return i;
      }
    }
    return -1;
  };
  for (const chunk of ordered) {
    const i = place(chunk, Math.min(dayIdx, studyDays.length - 1));
    if (i === -1) {
      warnings.push(`Not enough time left to schedule all sessions for "${chunk.topic.name}".`);
      continue;
    }
    // Move on to the next day once today is full.
    if ((capacity.get(studyDays[i]) ?? 0) < 15) dayIdx = i + 1;
    else dayIdx = i;
  }
  for (const chunk of late) {
    const i = place(chunk, Math.min(Math.max(reviewStart, 0), studyDays.length - 1));
    if (i === -1) place(chunk, 0);
  }

  tasks.sort((a, b) => (a.date === b.date ? b.priority - a.priority : a.date < b.date ? -1 : 1));
  return { tasks, warnings: [...new Set(warnings)], neededMinutes, availableMinutes, studyDays };
}

function labelFor(kind: TaskKind) {
  return kind === "learn" ? "Learn" : kind === "practice" ? "Practice" : "Review";
}
type TaskKind = "learn" | "practice" | "review";

function buildReason(kind: TaskKind, why: string[]) {
  const base =
    kind === "learn"
      ? "First pass through this topic"
      : kind === "practice"
        ? "Practice problems on this topic"
        : "Spaced review closer to the exam helps it stick";
  return why.length ? `${base}, because ${why.join(" and ")}.` : `${base}.`;
}
