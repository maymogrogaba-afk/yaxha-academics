import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { isUuid } from "@/lib/data";
import { ButtonLink, Card, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { ActionForm } from "@/components/action-form";
import { saveSummary } from "@/app/actions/summaries";

export const metadata = { title: "Edit summary" };

export default async function EditSummaryPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const data = await withUser(user.id, async (tx) => {
    const [s] = await tx`select * from summaries where id = ${id}`;
    if (!s) return null;
    return { s, topics: await tx`select id, name from topics where subject_id = ${s.subject_id} order by name` };
  });
  if (!data) notFound();
  const { s, topics } = data;
  return (
    <>
      <PageHeader title="Edit summary" description="Markdown with LaTeX math ($...$ and $$...$$)." />
      <Card className="p-4 sm:p-6">
        <ActionForm action={saveSummary} className="flex flex-col gap-4">
          <input type="hidden" name="id" value={s.id} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Title" htmlFor="s-title">
              <Input id="s-title" name="title" defaultValue={s.title} maxLength={160} required />
            </Field>
            <Field label="Topic" htmlFor="s-topic">
              <Select id="s-topic" name="topicId" defaultValue={s.topic_id ?? ""}>
                <option value="">Whole subject</option>
                {topics.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Content" htmlFor="s-body">
            <Textarea id="s-body" name="body" defaultValue={s.body_md} rows={28} className="font-mono text-[13px]" required />
          </Field>
          <div className="flex gap-2">
            <SubmitButton>Save</SubmitButton>
            <ButtonLink href={`/summaries/${s.id}`} variant="ghost">
              Cancel
            </ButtonLink>
          </div>
        </ActionForm>
      </Card>
    </>
  );
}
