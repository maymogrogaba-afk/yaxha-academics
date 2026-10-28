import Link from "next/link";
import type { Row } from "postgres";
import { ExternalLink, Trash2 } from "lucide-react";
import { withUser } from "@/lib/db";
import { formatDateTime } from "@/lib/study/dates";
import { Badge, Button, ButtonLink, Card, CardHeader, Field, Input, ProgressBar, Select } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { ActionForm } from "@/components/action-form";
import { addTopic, deleteSubject, deleteTopic, setSubjectHidden, setTopicImportance } from "@/app/actions/subjects";

export async function OverviewTab({ userId, subject, tz }: { userId: string; subject: Row; tz: string }) {
  const { topics, recent, nextExam, stats } = await withUser(userId, async (tx) => ({
    topics: await tx`
      select t.*, m.attempts, m.recent_accuracy, m.last_practiced_at,
        (select count(*)::int from materials x where x.topic_id = t.id) as material_count
      from topics t left join topic_mastery m on m.topic_id = t.id
      where t.subject_id = ${subject.id} order by t.name`,
    recent: await tx`select id, title, kind, posted_at, created_at, seen_by_user, origin from materials
      where subject_id = ${subject.id} order by coalesce(posted_at, created_at) desc limit 5`,
    nextExam: (await tx`select id, title, exam_at from exams where subject_id = ${subject.id} and status = 'upcoming' and exam_at > now() order by exam_at limit 1`)[0],
    stats: (await tx`select
        (select count(*)::int from quiz_answers a join quiz_questions q on q.id = a.question_id where q.quiz_id in (select id from quizzes where subject_id = ${subject.id}) and not a.needs_review) as answered,
        (select coalesce(sum(a.score),0)::float from quiz_answers a join quiz_questions q on q.id = a.question_id where q.quiz_id in (select id from quizzes where subject_id = ${subject.id}) and not a.needs_review) as score,
        (select coalesce(sum(duration_minutes),0)::int from study_sessions where subject_id = ${subject.id}) as minutes`)[0],
  }));
  const imported = subject.source_provider === "google_classroom";

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="flex flex-col gap-4 lg:col-span-2">
        <Card>
          <CardHeader
            title="Topics"
            subtitle={imported ? "Topics come from Google Classroom. Set importance to guide your plan." : "Add the topics this subject covers."}
          />
          <ul className="divide-y divide-line">
            {topics.length === 0 && <li className="px-5 py-4 text-sm text-muted">No topics yet.</li>}
            {topics.map((t) => (
              <li key={t.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-ivory">{t.name}</div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-faint">
                    <span>{t.material_count} materials</span>
                    {t.attempts > 0 ? (
                      <span>· {Math.round(Number(t.recent_accuracy) * 100)}% recent accuracy ({t.attempts} questions)</span>
                    ) : (
                      <span>· not practiced yet</span>
                    )}
                  </div>
                  {t.attempts > 0 && (
                    <div className="mt-2 max-w-xs">
                      <ProgressBar value={Number(t.recent_accuracy)} label={`${t.name} accuracy`} />
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <form action={setTopicImportance} className="flex items-center gap-2">
                    <input type="hidden" name="id" value={t.id} />
                    <label className="text-xs text-faint" htmlFor={`imp-${t.id}`}>
                      Importance
                    </label>
                    <Select id={`imp-${t.id}`} name="importance" defaultValue={t.importance} className="h-8 w-16 text-xs">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </Select>
                    <Button size="sm" variant="ghost" type="submit">
                      Set
                    </Button>
                  </form>
                  {!t.source_topic_id && (
                    <form action={deleteTopic}>
                      <input type="hidden" name="id" value={t.id} />
                      <SubmitButton variant="ghost" size="sm" confirm={`Delete topic "${t.name}"? Materials stay in the subject.`}>
                        <Trash2 className="size-3.5" />
                        <span className="sr-only">Delete topic</span>
                      </SubmitButton>
                    </form>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <div className="border-t border-line px-4 py-3 sm:px-5">
            <ActionForm action={addTopic} resetOnSuccess className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <input type="hidden" name="subjectId" value={subject.id} />
              <div className="flex-1">
                <Field label="New topic" htmlFor="topic-name">
                  <Input id="topic-name" name="name" placeholder="e.g. Separable equations" required maxLength={200} />
                </Field>
              </div>
              <div className="w-full sm:w-28">
                <Field label="Importance" htmlFor="topic-imp">
                  <Select id="topic-imp" name="importance" defaultValue="3">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </Select>
                </Field>
              </div>
              <SubmitButton variant="secondary">Add topic</SubmitButton>
            </ActionForm>
          </div>
        </Card>

        <Card>
          <CardHeader title="Recently added" action={<ButtonLink href={`/subjects/${subject.id}?tab=materials`} size="sm" variant="ghost">All materials</ButtonLink>} />
          <ul className="divide-y divide-line">
            {recent.length === 0 && <li className="px-5 py-4 text-sm text-muted">No materials yet.</li>}
            {recent.map((m) => (
              <li key={m.id}>
                <Link href={`/materials/${m.id}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-raised/50 sm:px-5">
                  <span className="truncate text-ivory">{m.title}</span>
                  {!m.seen_by_user && m.origin === "imported" && <Badge tone="gold">New</Badge>}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="flex flex-col gap-4">
        <Card className="p-4 sm:p-5">
          <h2 className="text-sm font-semibold">At a glance</h2>
          <dl className="mt-3 grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-xs text-faint">Practice accuracy</dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums">{stats.answered ? `${Math.round((stats.score / stats.answered) * 100)}%` : "—"}</dd>
              <dd className="text-xs text-faint">{stats.answered} graded answers</dd>
            </div>
            <div>
              <dt className="text-xs text-faint">Study time logged</dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums">{Math.round(stats.minutes / 6) / 10} h</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs text-faint">Next exam</dt>
              <dd className="mt-1">
                {nextExam ? (
                  <Link className="text-gold hover:underline" href={`/exams/${nextExam.id}`}>
                    {nextExam.title} · {formatDateTime(nextExam.exam_at, tz)}
                  </Link>
                ) : (
                  <Link className="text-muted hover:text-ivory" href={`/exams?subject=${subject.id}`}>
                    None scheduled — plan one
                  </Link>
                )}
              </dd>
            </div>
          </dl>
        </Card>

        <Card className="p-4 sm:p-5">
          <h2 className="text-sm font-semibold">Source</h2>
          {imported ? (
            <dl className="mt-3 space-y-2 text-sm">
              <Detail label="Classroom name" value={subject.source_course_name} />
              {subject.source_section && <Detail label="Section" value={subject.source_section} />}
              {subject.source_teacher && <Detail label="Teacher" value={subject.source_teacher} />}
              <Detail label="Course id" value={<span className="font-mono text-xs">{subject.source_course_id}</span>} />
              <Detail label="Status in Classroom" value={subject.source_course_state ?? subject.source_status} />
              {subject.source_description && <Detail label="Description" value={<span className="whitespace-pre-line">{subject.source_description}</span>} />}
              {subject.source_link && (
                <a href={subject.source_link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-gold hover:underline">
                  Open in Google Classroom <ExternalLink className="size-3.5" />
                </a>
              )}
            </dl>
          ) : (
            <p className="mt-2 text-sm text-muted">Created by you in Yaxha.</p>
          )}
          <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
            <form action={setSubjectHidden}>
              <input type="hidden" name="id" value={subject.id} />
              <input type="hidden" name="hidden" value={subject.hidden ? "false" : "true"} />
              <SubmitButton variant="ghost" size="sm">
                {subject.hidden ? "Show in My Subjects" : "Hide subject"}
              </SubmitButton>
            </form>
            {!imported && (
              <form action={deleteSubject}>
                <input type="hidden" name="id" value={subject.id} />
                <SubmitButton variant="danger" size="sm" confirm="Delete this subject and everything in it (materials, summaries, quizzes, flashcards, exams)? This cannot be undone.">
                  Delete subject
                </SubmitButton>
              </form>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="mt-0.5 text-ivory">{value}</dd>
    </div>
  );
}
