import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { getPrefs } from "@/lib/data";
import { formatDateTime } from "@/lib/study/dates";
import { Badge, ButtonLink, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { ExamForm } from "@/components/exam-form";

export const metadata = { title: "Exam Planner" };

export default async function ExamsPage({ searchParams }: { searchParams: Promise<{ subject?: string }> }) {
  const user = await requireUser();
  const { subject } = await searchParams;
  const data = await withUser(user.id, async (tx) => {
    const prefs = await getPrefs(tx);
    return {
      prefs,
      exams: await tx`
        select e.*, s.display_name as subject_name,
          (select count(*)::int from exam_topics et where et.exam_id = e.id) as topic_count,
          (select count(*)::int from study_tasks t where t.exam_id = e.id and t.status = 'done') as done,
          (select count(*)::int from study_tasks t where t.exam_id = e.id) as total
        from exams e join subjects s on s.id = e.subject_id order by (e.status = 'upcoming' and e.exam_at > now()) desc, e.exam_at`,
      subjects: await tx`select id, display_name from subjects where not hidden order by display_name`,
      topics: await tx`select id, name, subject_id from topics order by name`,
    };
  });
  const upcoming = data.exams.filter((e) => e.status === "upcoming" && new Date(e.exam_at) > new Date());
  const past = data.exams.filter((e) => !upcoming.includes(e));
  return (
    <>
      <PageHeader title="Exam Planner" description="Tell Yaxha what the exam covers and how much time you have. It builds a realistic plan that adapts to your practice results." />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Upcoming exams" />
            {upcoming.length === 0 ? (
              <div className="p-4">
                <EmptyState icon={<CalendarClock className="size-6" />} title="No upcoming exams">
                  Create one to get a day-by-day preparation plan.
                </EmptyState>
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {upcoming.map((e) => (
                  <li key={e.id}>
                    <Link href={`/exams/${e.id}`} className="block px-4 py-3 hover:bg-raised/40 sm:px-5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm text-ivory">{e.title}</span>
                        <span className="text-xs text-gold">{formatDateTime(e.exam_at, data.prefs.timezone)}</span>
                      </div>
                      <div className="mt-1 text-xs text-faint">
                        {e.subject_name} · {e.topic_count} topics · {e.done}/{e.total} sessions done
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {past.length > 0 && (
            <Card>
              <CardHeader title="Past and closed" />
              <ul className="divide-y divide-line">
                {past.map((e) => (
                  <li key={e.id}>
                    <Link href={`/exams/${e.id}`} className="flex items-center justify-between gap-2 px-4 py-3 text-sm hover:bg-raised/40 sm:px-5">
                      <span className="text-muted">{e.title}</span>
                      <Badge>{e.status === "upcoming" ? "Date passed" : e.status}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        <Card className="p-4 sm:p-6">
          <h2 className="mb-4 text-sm font-semibold">Plan a new exam</h2>
          {data.subjects.length === 0 ? (
            <EmptyState title="Add a subject first" action={<ButtonLink href="/subjects">My Subjects</ButtonLink>} />
          ) : (
            <ExamForm
              initialSubject={subject}
              defaultHours={Math.round((data.prefs.daily_target_minutes / 60) * 4) / 4}
              subjects={data.subjects.map((s) => ({
                id: s.id,
                name: s.display_name,
                topics: data.topics.filter((t) => t.subject_id === s.id).map((t) => ({ id: t.id, name: t.name })),
              }))}
            />
          )}
        </Card>
      </div>
    </>
  );
}
