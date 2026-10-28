import type { Row } from "postgres";
import { withUser } from "@/lib/db";
import { MISTAKE_LABELS } from "@/lib/study/recommend";
import { formatDateTime } from "@/lib/study/dates";
import { Card, CardHeader, EmptyState, ProgressBar } from "@/components/ui";

export async function SubjectProgressTab({ userId, subject, tz }: { userId: string; subject: Row; tz: string }) {
  const { topics, coverage } = await withUser(userId, async (tx) => ({
    topics: await tx`
      select t.name, m.attempts, m.correct, m.recent_accuracy, m.last_practiced_at, m.next_review_at, m.mistake_counts
      from topics t left join topic_mastery m on m.topic_id = t.id where t.subject_id = ${subject.id}
      order by m.recent_accuracy nulls first, t.name`,
    coverage: (await tx`
      select count(*)::int as total,
        count(*) filter (where exists (select 1 from summaries s where m.id = any(s.source_material_ids))
                            or exists (select 1 from quizzes q where m.id = any(q.source_material_ids)))::int as studied,
        count(*) filter (where m.processing_status = 'ready')::int as readable
      from materials m where m.subject_id = ${subject.id}`)[0],
  }));
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader title="Topic mastery" subtitle="From graded quiz answers. Answers waiting for your review are not counted." />
        {topics.length === 0 ? (
          <div className="p-5">
            <EmptyState title="No topics yet">Add topics on the Overview tab to track mastery per topic.</EmptyState>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {topics.map((t) => {
              const mistakes = Object.entries((t.mistake_counts ?? {}) as Record<string, number>).sort((a, b) => b[1] - a[1]);
              return (
                <li key={t.name} className="px-4 py-3 sm:px-5">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-ivory">{t.name}</span>
                    <span className="tabular-nums text-muted">{t.attempts ? `${Math.round(Number(t.recent_accuracy) * 100)}%` : "—"}</span>
                  </div>
                  {t.attempts > 0 && (
                    <>
                      <div className="mt-2">
                        <ProgressBar value={Number(t.recent_accuracy)} label={`${t.name} accuracy`} />
                      </div>
                      <p className="mt-1.5 text-xs text-faint">
                        {Math.round(Number(t.correct) * 10) / 10} of {t.attempts} correct overall · last practiced {formatDateTime(t.last_practiced_at, tz)} · next review{" "}
                        {formatDateTime(t.next_review_at, tz)}
                        {mistakes.length > 0 && <> · mistakes: {mistakes.map(([k, n]) => `${MISTAKE_LABELS[k] ?? k} (${n})`).join(", ")}</>}
                      </p>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <Card className="p-4 sm:p-5">
        <h2 className="text-sm font-semibold">Material coverage</h2>
        <p className="mt-1 text-xs text-muted">Materials you have generated a summary or quiz from.</p>
        <div className="mt-4 text-2xl font-semibold tabular-nums">
          {coverage.studied} <span className="text-base font-normal text-faint">/ {coverage.total}</span>
        </div>
        <div className="mt-2">
          <ProgressBar value={coverage.total ? coverage.studied / coverage.total : 0} label="Material coverage" />
        </div>
        <p className="mt-3 text-xs text-faint">{coverage.readable} of {coverage.total} materials have readable text for AI study packs.</p>
      </Card>
    </div>
  );
}
