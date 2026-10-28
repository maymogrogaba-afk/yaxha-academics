// Exam readiness from recorded evidence only. It is a study-progress signal, not a grade prediction.
export type ReadinessTopic = {
  name: string;
  attempts: number;
  recentAccuracy: number | null;
  lastPracticedAt: Date | null;
  mistakeCounts: Record<string, number>;
};

export function readiness(topics: ReadinessTopic[], now = new Date()) {
  if (!topics.length) return { score: null as number | null, parts: [] as { label: string; value: string }[], notes: ["Add the covered topics to measure readiness."] };
  const practiced = topics.filter((t) => t.attempts > 0);
  const coverage = practiced.length / topics.length;
  const accuracy = practiced.length ? practiced.reduce((s, t) => s + (t.recentAccuracy ?? 0), 0) / practiced.length : 0;
  const recent = topics.filter((t) => t.lastPracticedAt && now.getTime() - t.lastPracticedAt.getTime() < 7 * 86_400_000).length / topics.length;
  const repeated = topics.filter((t) => Object.values(t.mistakeCounts ?? {}).some((n) => n >= 3));
  const score = Math.max(0, Math.min(1, 0.35 * coverage + 0.45 * accuracy * coverage + 0.2 * recent - 0.05 * repeated.length));
  const notes: string[] = [];
  const unpracticed = topics.filter((t) => t.attempts === 0).map((t) => t.name);
  if (unpracticed.length) notes.push(`No practice recorded yet: ${unpracticed.slice(0, 5).join(", ")}${unpracticed.length > 5 ? "…" : ""}.`);
  const weak = practiced.filter((t) => (t.recentAccuracy ?? 0) < 0.6).map((t) => t.name);
  if (weak.length) notes.push(`Below 60% recent accuracy: ${weak.join(", ")}.`);
  if (repeated.length) notes.push(`Repeated mistakes in: ${repeated.map((t) => t.name).join(", ")}.`);
  return {
    score: Math.round(score * 100) / 100,
    parts: [
      { label: "Topics practised", value: `${practiced.length} of ${topics.length}` },
      { label: "Average recent accuracy", value: practiced.length ? `${Math.round(accuracy * 100)}%` : "—" },
      { label: "Practised in the last 7 days", value: `${Math.round(recent * 100)}% of topics` },
    ],
    notes,
  };
}
