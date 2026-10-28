import Link from "next/link";
import type { Row } from "postgres";
import { ExternalLink } from "lucide-react";
import { withUser } from "@/lib/db";
import { formatDateTime } from "@/lib/study/dates";
import { Badge, Card, CardHeader, EmptyState, Field, Input, Textarea } from "@/components/ui";
import { Dialog, SubmitButton } from "@/components/client";
import { ActionForm } from "@/components/action-form";
import { Markdown } from "@/components/markdown";
import { createAssignment, toggleAssignment } from "@/app/actions/subjects";

const STATE_LABEL: Record<string, string> = {
  NEW: "Not started",
  CREATED: "Not turned in",
  TURNED_IN: "Turned in",
  RETURNED: "Returned",
  RECLAIMED_BY_STUDENT: "Unsubmitted",
};

export async function AssignmentsTab({ userId, subject, tz }: { userId: string; subject: Row; tz: string }) {
  const rows = await withUser(userId, (tx) => tx`
    select a.*, t.name as topic_name,
      (select json_agg(json_build_object('id', m.id, 'title', m.title, 'kind', m.kind)) from materials m where m.assignment_id = a.id) as attachments
    from assignments a left join topics t on t.id = a.topic_id
    where a.subject_id = ${subject.id}
    order by a.completed, a.due_at nulls last, a.created_at desc`);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {subject.source_provider === "google_classroom"
            ? "Assignments come from Google Classroom. Yaxha shows them for planning; submit your work in Classroom."
            : "Track assignments and due dates for this subject."}
        </p>
        <Dialog title="Add an assignment" trigger="Add assignment">
          <ActionForm action={createAssignment} resetOnSuccess>
            <input type="hidden" name="subjectId" value={subject.id} />
            <Field label="Title" htmlFor="as-title">
              <Input id="as-title" name="title" required maxLength={200} />
            </Field>
            <Field label="Due" htmlFor="as-due">
              <Input id="as-due" name="due" type="datetime-local" />
            </Field>
            <Field label="Instructions (optional)" htmlFor="as-ins">
              <Textarea id="as-ins" name="instructions" rows={4} />
            </Field>
            <SubmitButton>Add</SubmitButton>
          </ActionForm>
        </Dialog>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No assignments">Imported Classroom assignments and ones you add will appear here.</EmptyState>
      ) : (
        rows.map((a) => {
          const overdue = a.due_at && !a.completed && new Date(a.due_at) < new Date();
          return (
            <Card key={a.id}>
              <CardHeader
                title={<span className={a.completed ? "text-muted line-through" : ""}>{a.title}</span>}
                subtitle={
                  <span className="flex flex-wrap gap-x-2">
                    {a.due_at ? <span className={overdue ? "text-bad" : ""}>Due {formatDateTime(a.due_at, tz)}</span> : <span>No due date</span>}
                    {a.topic_name && <span>· {a.topic_name}</span>}
                    {a.max_points && <span>· {Number(a.max_points)} points</span>}
                  </span>
                }
                action={
                  <form action={toggleAssignment}>
                    <input type="hidden" name="id" value={a.id} />
                    <SubmitButton size="sm" variant={a.completed ? "ghost" : "secondary"}>
                      {a.completed ? "Mark not done" : "Mark done"}
                    </SubmitButton>
                  </form>
                }
              />
              <div className="flex flex-col gap-3 px-4 py-3 sm:px-5">
                <div className="flex flex-wrap gap-1.5">
                  {a.origin === "imported" ? <Badge tone="info">Classroom</Badge> : <Badge>Added by you</Badge>}
                  {a.submission_state && <Badge tone={a.submission_state === "TURNED_IN" || a.submission_state === "RETURNED" ? "ok" : "neutral"}>{STATE_LABEL[a.submission_state] ?? a.submission_state}</Badge>}
                  {a.source_removed && <Badge tone="warn">No longer in Classroom</Badge>}
                </div>
                {a.instructions && <Markdown className="prose-yx text-sm text-muted">{a.instructions}</Markdown>}
                {a.attachments?.length > 0 && (
                  <ul className="flex flex-wrap gap-2">
                    {a.attachments.map((m: { id: string; title: string }) => (
                      <li key={m.id}>
                        <Link href={`/materials/${m.id}`} className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-ivory hover:border-gold/50">
                          {m.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                {a.source_url && (
                  <a href={a.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-gold hover:underline">
                    Open in Google Classroom <ExternalLink className="size-3.5" />
                  </a>
                )}
              </div>
            </Card>
          );
        })
      )}
    </div>
  );
}
