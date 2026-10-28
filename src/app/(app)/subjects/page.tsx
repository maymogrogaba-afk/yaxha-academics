import Link from "next/link";
import { BookOpen, GraduationCap, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { listSubjects, getPrefs } from "@/lib/data";
import { formatDateTime } from "@/lib/study/dates";
import { Badge, ButtonLink, Card, EmptyState, Field, Input, PageHeader } from "@/components/ui";
import { Dialog, SubmitButton } from "@/components/client";
import { ActionForm } from "@/components/action-form";
import { createSubject } from "@/app/actions/subjects";

export const metadata = { title: "My Subjects" };

export default async function SubjectsPage({ searchParams }: { searchParams: Promise<{ hidden?: string }> }) {
  const user = await requireUser();
  const { hidden } = await searchParams;
  const showHidden = hidden === "1";
  const { subjects, prefs, hiddenCount } = await withUser(user.id, async (tx) => ({
    subjects: await listSubjects(tx, showHidden),
    prefs: await getPrefs(tx),
    hiddenCount: (await tx`select count(*)::int as n from subjects where hidden`)[0].n as number,
  }));

  const addDialog = (
    <Dialog
      title="Add a subject"
      trigger={
        <>
          <Plus className="size-4" /> Add subject
        </>
      }
    >
      <ActionForm action={createSubject}>
        <Field label="Subject name" htmlFor="new-subject">
          <Input id="new-subject" name="name" placeholder="e.g. Building Systems Design" required maxLength={200} />
        </Field>
        <SubmitButton>Create subject</SubmitButton>
      </ActionForm>
    </Dialog>
  );

  return (
    <>
      <PageHeader
        title="My Subjects"
        description="Subjects imported from Google Classroom and ones you added yourself."
        actions={
          <>
            <ButtonLink href="/classroom" size="sm" variant="ghost">
              <GraduationCap className="size-4" /> Classroom sync
            </ButtonLink>
            {addDialog}
          </>
        }
      />
      {subjects.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="size-6" />}
          title="No subjects yet"
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <ButtonLink href="/classroom" variant="primary">
                Connect Google Classroom
              </ButtonLink>
              {addDialog}
            </div>
          }
        >
          Connect Google Classroom to import your classes automatically, or add a subject yourself.
        </EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {subjects.map((s) => (
            <li key={s.id}>
              <Link href={`/subjects/${s.id}`} className="block h-full">
                <Card className="flex h-full flex-col p-4 transition-colors hover:border-line-strong">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="font-medium leading-snug text-ivory">{s.display_name}</h2>
                    {s.new_count > 0 && <Badge tone="gold">{s.new_count} new</Badge>}
                  </div>
                  {s.name_customized && s.source_course_name && (
                    <p className="mt-1 truncate text-xs text-faint" title={s.source_course_name}>
                      Classroom: {s.source_course_name}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {s.source_provider === "google_classroom" ? <Badge tone="info">Classroom</Badge> : <Badge>Added by you</Badge>}
                    {s.source_status === "archived" && <Badge tone="warn">Archived in Classroom</Badge>}
                    {s.source_status === "unavailable" && <Badge tone="warn">No longer in Classroom</Badge>}
                    {s.hidden && <Badge>Hidden</Badge>}
                  </div>
                  <dl className="mt-auto grid grid-cols-3 gap-2 pt-4 text-xs">
                    <div>
                      <dt className="text-faint">Materials</dt>
                      <dd className="mt-0.5 tabular-nums text-ivory">{s.material_count}</dd>
                    </div>
                    <div>
                      <dt className="text-faint">Open tasks</dt>
                      <dd className="mt-0.5 tabular-nums text-ivory">{s.open_assignments}</dd>
                    </div>
                    <div>
                      <dt className="text-faint">Next exam</dt>
                      <dd className="mt-0.5 text-ivory">{s.next_exam ? formatDateTime(s.next_exam, prefs.timezone).split(",")[0] : "—"}</dd>
                    </div>
                  </dl>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {(hiddenCount > 0 || showHidden) && (
        <p className="mt-6 text-sm text-muted">
          <Link href={showHidden ? "/subjects" : "/subjects?hidden=1"} className="text-gold hover:underline">
            {showHidden ? "Hide hidden subjects" : `Show ${hiddenCount} hidden subject${hiddenCount === 1 ? "" : "s"}`}
          </Link>
        </p>
      )}
    </>
  );
}
