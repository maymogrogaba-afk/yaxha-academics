import { describe, expect, it } from "vitest";
import { scheduleCard, updateMastery } from "@/lib/study/srs";
import { buildExamPlan, topicNeed } from "@/lib/study/planner";
import { recommend } from "@/lib/study/recommend";
import { readiness } from "@/lib/study/readiness";
import { addDays, daysBetween, todayIn, zonedToDate, toLocalInput } from "@/lib/study/dates";

describe("spaced repetition", () => {
  const fresh = { ease: 2.5, interval: 0, repetitions: 0, lapses: 0 };
  it("grows intervals when remembered", () => {
    const a = scheduleCard(fresh, 3);
    expect(a.interval).toBe(1);
    const b = scheduleCard({ ...a, interval: a.interval }, 3);
    expect(b.interval).toBe(3);
    const c = scheduleCard({ ...b, interval: b.interval }, 3);
    expect(c.interval).toBe(Math.round(3 * b.ease));
  });
  it("resets and lowers ease when forgotten", () => {
    const r = scheduleCard({ ease: 2.5, interval: 10, repetitions: 4, lapses: 0 }, 1);
    expect(r.interval).toBe(0);
    expect(r.repetitions).toBe(0);
    expect(r.lapses).toBe(1);
    expect(r.ease).toBeCloseTo(2.3);
  });
  it("mastery: weak results bring review back tomorrow, strong results space it out", () => {
    const base = { attempts: 0, correct: 0, recentAccuracy: null, intervalDays: 1, mistakeCounts: {} };
    expect(updateMastery(base, 1, 5, ["algebra"]).intervalDays).toBe(1);
    const good = updateMastery({ ...base, intervalDays: 4 }, 5, 5, []);
    expect(good.intervalDays).toBe(8);
    expect(updateMastery(base, 1, 5, ["algebra", "algebra"]).mistakeCounts).toEqual({ algebra: 2 });
  });
});

describe("exam planner", () => {
  const topics = [
    { id: "t1", name: "Separable equations", difficulty: 4, confidence: 2, importance: 4 },
    { id: "t2", name: "Exact equations", difficulty: 3, confidence: 3, importance: 3 },
    { id: "t3", name: "Integrating factors", difficulty: 2, confidence: 4, importance: 3, accuracy: 0.9, practiced: 10 },
  ];
  const input = {
    today: "2026-10-28",
    examDate: "2026-11-07",
    minutesPerDay: 120,
    sessionMinutes: 45,
    availableWeekdays: [1, 2, 3, 4, 5, 6],
    unavailableDates: ["2026-11-01", "2026-11-02"],
    topics,
    examTitle: "Midterm",
  };
  it("schedules only on available days before the exam and ends with a mock exam", () => {
    const plan = buildExamPlan(input);
    expect(plan.tasks.length).toBeGreaterThan(0);
    for (const t of plan.tasks) {
      expect(t.date >= input.today && t.date < input.examDate).toBe(true);
      expect(input.unavailableDates).not.toContain(t.date);
      expect(new Date(t.date + "T00:00:00Z").getUTCDay()).not.toBe(0);
    }
    const last = plan.studyDays[plan.studyDays.length - 1];
    expect(plan.tasks.some((t) => t.kind === "mock_exam" && t.date === last)).toBe(true);
  });
  it("never exceeds the daily study time", () => {
    const plan = buildExamPlan(input);
    const perDay = new Map<string, number>();
    for (const t of plan.tasks) perDay.set(t.date, (perDay.get(t.date) ?? 0) + t.minutes);
    for (const m of perDay.values()) expect(m).toBeLessThanOrEqual(120);
  });
  it("gives weak, important topics more time than mastered ones", () => {
    expect(topicNeed(topics[0]).minutes).toBeGreaterThan(topicNeed(topics[2]).minutes);
    const plan = buildExamPlan(input);
    const sum = (id: string) => plan.tasks.filter((t) => t.topicId === id).reduce((s, t) => s + t.minutes, 0);
    expect(sum("t1")).toBeGreaterThan(sum("t3"));
  });
  it("warns about unrealistic schedules instead of silently overbooking", () => {
    const plan = buildExamPlan({ ...input, examDate: "2026-10-30", minutesPerDay: 30 });
    expect(plan.warnings.join(" ")).toMatch(/only/);
    const past = buildExamPlan({ ...input, examDate: "2026-10-27" });
    expect(past.tasks).toHaveLength(0);
    expect(past.warnings[0]).toMatch(/past/);
  });
  it("explains every session with a reason", () => {
    for (const t of buildExamPlan(input).tasks) expect(t.reason.length).toBeGreaterThan(10);
  });
  it("subtracts time already completed", () => {
    const done = buildExamPlan({ ...input, topics: [{ ...topics[0], doneMinutes: 10_000 }] });
    expect(done.tasks.filter((t) => t.topicId === "t1")).toHaveLength(0);
  });
});

describe("recommendations", () => {
  const now = new Date("2026-10-28T02:00:00Z");
  const base = {
    today: "2026-10-28",
    now,
    sessionMinutes: 45,
    assignments: [],
    exams: [],
    topics: [{ id: "t1", name: "Separable equations", subjectId: "s1", subjectName: "Differential Equations", importance: 3 }],
    mastery: [],
    dueCards: [],
  };
  it("returns nothing without data (never invents reasons)", () => {
    expect(recommend(base)).toEqual([]);
  });
  it("cites real accuracy and mistake data", () => {
    const recs = recommend({
      ...base,
      mastery: [{ topicId: "t1", attempts: 8, recentAccuracy: 0.45, lastPracticedAt: new Date("2026-10-20T00:00:00Z"), nextReviewAt: new Date("2026-10-27T00:00:00Z"), mistakeCounts: { formula_selection: 3 } }],
    });
    expect(recs[0].reason).toContain("45%");
    expect(recs[0].title).toBe("Separable equations");
  });
  it("prioritises an assignment due tomorrow", () => {
    const recs = recommend({
      ...base,
      assignments: [{ id: "a1", title: "Problem Set 3", subjectId: "s1", subjectName: "DE", dueDate: "2026-10-29", completed: false }],
      dueCards: [{ subjectId: "s1", subjectName: "DE", deckId: "d1", count: 5 }],
    });
    expect(recs[0].kind).toBe("assignment");
    expect(recs[0].reason).toBe("This assignment is due in 1 day.");
  });
  it("mentions an upcoming exam and missing practice", () => {
    const recs = recommend({ ...base, exams: [{ id: "e1", title: "Midterm", subjectId: "s1", subjectName: "DE", examDate: "2026-11-04", topicIds: ["t1"] }] });
    expect(recs[0].reason).toMatch(/Midterm.*7 days.*no practice/);
  });
});

describe("readiness", () => {
  it("is null without topics and reflects coverage and accuracy", () => {
    expect(readiness([]).score).toBeNull();
    const now = new Date();
    const low = readiness([{ name: "A", attempts: 0, recentAccuracy: null, lastPracticedAt: null, mistakeCounts: {} }]);
    const high = readiness([{ name: "A", attempts: 10, recentAccuracy: 0.9, lastPracticedAt: now, mistakeCounts: {} }]);
    expect(high.score!).toBeGreaterThan(low.score!);
    expect(low.notes[0]).toMatch(/No practice/);
  });
});

describe("dates", () => {
  it("handles Manila time correctly", () => {
    expect(todayIn("Asia/Manila", new Date("2026-10-28T17:00:00Z"))).toBe("2026-10-29");
    expect(zonedToDate("2026-11-07T08:00", "Asia/Manila")!.toISOString()).toBe("2026-11-07T00:00:00.000Z");
    expect(toLocalInput("2026-11-07T00:00:00.000Z", "Asia/Manila")).toBe("2026-11-07T08:00");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(daysBetween("2026-10-28", "2026-11-07")).toBe(10);
  });
});
