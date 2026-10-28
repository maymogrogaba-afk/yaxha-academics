import Link from "next/link";
import { Bookmark } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { aiAvailable } from "@/lib/ai/provider";
import { TUTOR_MODES } from "@/lib/ai/prompts";
import { formatDateTime } from "@/lib/study/dates";
import { Badge, ButtonLink, Card, CardHeader, EmptyState, Notice, PageHeader } from "@/components/ui";
import { NewSessionForm } from "@/components/new-session-form";

export const metadata = { title: "AI Study Room" };

export default async function StudyRoom({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const data = await withUser(user.id, async (tx) => {
    const subjects = await tx`select id, display_name from subjects where not hidden order by display_name`;
    const topics = await tx`select id, name, subject_id from topics order by name`;
    const materials = await tx`select id, title, subject_id from materials where processing_status = 'ready' order by coalesce(posted_at, created_at) desc limit 500`;
    const sessions = await tx`
      select ts.id, ts.title, ts.mode, ts.saved, ts.updated_at, s.display_name as subject_name,
        (select count(*)::int from tutor_messages m where m.session_id = ts.id) as n
      from tutor_sessions ts left join subjects s on s.id = ts.subject_id order by ts.saved desc, ts.updated_at desc limit 30`;
    const [{ tz }] = await tx`select coalesce((select timezone from user_preferences), 'Asia/Manila') as tz`;
    return { subjects, topics, materials, sessions, tz: tz as string };
  });
  const ai = aiAvailable();
  return (
    <>
      <PageHeader title="AI Study Room" description="A patient tutor for engineering concepts and problems. It shows the steps and checks the answer." />
      {!ai && (
        <div className="mb-4">
          <Notice tone="warn" title="AI is not configured yet">
            The tutor needs an AI provider key on the server (AI_API_KEY). Everything else in Yaxha works without it. See the README section “Set up AI”.
          </Notice>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="p-4 sm:p-6">
          <h2 className="mb-4 text-sm font-semibold">New session</h2>
          {data.subjects.length === 0 ? (
            <EmptyState title="Add a subject first" action={<ButtonLink href="/subjects">Go to My Subjects</ButtonLink>}>
              Sessions are kept per subject so the tutor knows the context.
            </EmptyState>
          ) : (
            <NewSessionForm
              disabled={!ai}
              modes={Object.entries(TUTOR_MODES).map(([key, m]) => ({ key, label: m.label, description: m.description }))}
              subjects={data.subjects.map((s) => ({
                id: s.id,
                name: s.display_name,
                topics: data.topics.filter((t) => t.subject_id === s.id).map((t) => ({ id: t.id, name: t.name })),
                materials: data.materials.filter((m) => m.subject_id === s.id).map((m) => ({ id: m.id, title: m.title })),
              }))}
              initial={{ mode: sp.mode, subject: sp.subject, topic: sp.topic, material: sp.material }}
            />
          )}
        </Card>
        <Card>
          <CardHeader title="Your sessions" subtitle="Saved sessions stay at the top." />
          {data.sessions.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted">No sessions yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {data.sessions.map((s) => (
                <li key={s.id}>
                  <Link href={`/study/${s.id}`} className="block px-4 py-3 hover:bg-raised/40">
                    <div className="flex items-center gap-1.5 text-sm text-ivory">
                      {s.saved && <Bookmark className="size-3.5 shrink-0 text-gold" aria-label="Saved" />}
                      <span className="truncate">{s.title}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-faint">
                      <Badge>{TUTOR_MODES[s.mode as keyof typeof TUTOR_MODES]?.label}</Badge>
                      {s.subject_name} · {formatDateTime(s.updated_at, data.tz)}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
