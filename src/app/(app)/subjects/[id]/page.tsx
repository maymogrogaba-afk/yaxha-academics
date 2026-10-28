import { notFound } from "next/navigation";
import { Pencil, RotateCcw, Sparkles } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { getPrefs, getSubject } from "@/lib/data";
import { Badge, ButtonLink, Field, Input, PageHeader, Tabs } from "@/components/ui";
import { Dialog, SubmitButton } from "@/components/client";
import { ActionForm } from "@/components/action-form";
import { renameSubject, restoreSubjectName } from "@/app/actions/subjects";
import { OverviewTab } from "./overview";
import { MaterialsTab } from "./materials";
import { AssignmentsTab } from "./assignments";
import { SummariesTab, QuizzesTab, FlashcardsTab } from "./packs";
import { SubjectProgressTab } from "./progress";

const TABS = [
  ["overview", "Overview"],
  ["materials", "All Materials"],
  ["assignments", "Assignments"],
  ["summaries", "Summaries"],
  ["quizzes", "Quizzes"],
  ["flashcards", "Flashcards"],
  ["progress", "Progress"],
] as const;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const s = await withUser(user.id, (tx) => getSubject(tx, id));
  return { title: s?.display_name ?? "Subject" };
}

export default async function SubjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const tab = (TABS.find(([k]) => k === sp.tab)?.[0] ?? "overview") as (typeof TABS)[number][0];
  const { subject, counts, prefs } = await withUser(user.id, async (tx) => {
    const subject = await getSubject(tx, id);
    if (!subject) return { subject: null, counts: null, prefs: null };
    const [counts] = await tx`select
      (select count(*)::int from materials where subject_id = ${id}) as materials,
      (select count(*)::int from assignments where subject_id = ${id}) as assignments,
      (select count(*)::int from summaries where subject_id = ${id}) as summaries,
      (select count(*)::int from quizzes where subject_id = ${id}) as quizzes,
      (select count(*)::int from flashcard_decks where subject_id = ${id}) as flashcards`;
    return { subject, counts, prefs: await getPrefs(tx) };
  });
  if (!subject || !counts || !prefs) notFound();

  const imported = subject.source_provider === "google_classroom";

  return (
    <>
      <PageHeader
        eyebrow={imported ? "Google Classroom subject" : "Subject"}
        title={subject.display_name}
        description={
          imported && subject.name_customized ? (
            <span>
              Original Classroom name: <span className="text-ivory">{subject.source_course_name}</span>
            </span>
          ) : (
            subject.source_section ?? undefined
          )
        }
        actions={
          <>
            <Dialog
              title="Edit subject name"
              trigger={
                <>
                  <Pencil className="size-3.5" /> Edit Subject Name
                </>
              }
            >
              <ActionForm action={renameSubject}>
                <input type="hidden" name="id" value={subject.id} />
                <Field
                  label="Name shown in Yaxha"
                  htmlFor="subject-name"
                  hint={imported ? "This only changes the name inside Yaxha. Your Google Classroom course, its id, and all your materials and progress stay the same." : undefined}
                >
                  <Input id="subject-name" name="name" defaultValue={subject.display_name} maxLength={200} required />
                </Field>
                <SubmitButton>Save name</SubmitButton>
              </ActionForm>
              {imported && subject.name_customized && (
                <form action={restoreSubjectName} className="mt-4 border-t border-line pt-4">
                  <input type="hidden" name="id" value={subject.id} />
                  <p className="mb-2 text-xs text-muted">Original: {subject.source_course_name}</p>
                  <SubmitButton variant="ghost" size="sm">
                    <RotateCcw className="size-3.5" /> Restore original name
                  </SubmitButton>
                </form>
              )}
            </Dialog>
            <ButtonLink href={`/study?subject=${subject.id}`} variant="primary" size="sm">
              <Sparkles className="size-4" /> Start Studying
            </ButtonLink>
          </>
        }
      />
      {subject.source_status !== "active" && (
        <div className="mb-4">
          <Badge tone="warn">
            {subject.source_status === "archived"
              ? "This class is archived in Google Classroom. Your study content is kept."
              : "This class is no longer returned by Google Classroom. Your materials and study content are kept."}
          </Badge>
        </div>
      )}
      <Tabs
        active={tab}
        items={TABS.map(([key, label]) => ({
          key,
          label,
          href: `/subjects/${subject.id}${key === "overview" ? "" : `?tab=${key}`}`,
          count: key === "overview" || key === "progress" ? undefined : (counts as Record<string, number>)[key],
        }))}
      />
      {tab === "overview" && <OverviewTab userId={user.id} subject={subject} tz={prefs.timezone} />}
      {tab === "materials" && <MaterialsTab userId={user.id} subject={subject} sp={sp} tz={prefs.timezone} />}
      {tab === "assignments" && <AssignmentsTab userId={user.id} subject={subject} tz={prefs.timezone} />}
      {tab === "summaries" && <SummariesTab userId={user.id} subject={subject} tz={prefs.timezone} />}
      {tab === "quizzes" && <QuizzesTab userId={user.id} subject={subject} tz={prefs.timezone} />}
      {tab === "flashcards" && <FlashcardsTab userId={user.id} subject={subject} tz={prefs.timezone} />}
      {tab === "progress" && <SubjectProgressTab userId={user.id} subject={subject} tz={prefs.timezone} />}
    </>
  );
}
