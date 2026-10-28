import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, Pencil, RefreshCw } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { isUuid } from "@/lib/data";
import { aiAvailable } from "@/lib/ai/provider";
import { SUMMARY_MODES } from "@/lib/ai/prompts";
import { formatDateTime } from "@/lib/study/dates";
import { Badge, ButtonLink, Card, Notice, PageHeader, Select, buttonClass } from "@/components/ui";
import { Dialog, SubmitButton } from "@/components/client";
import { ActionForm } from "@/components/action-form";
import { Markdown } from "@/components/markdown";
import { PrintButton } from "@/components/print-button";
import { deleteSummary } from "@/app/actions/summaries";
import { generateSummaryAction } from "@/app/actions/generate";

export const metadata = { title: "Summary" };
export const maxDuration = 300;

type Cov = { ref: string; materialId: string | null; title: string; usedLabels: string; usedParts: number; totalParts: number; partial: boolean };

export default async function SummaryPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const data = await withUser(user.id, async (tx) => {
    const [s] = await tx`select s.*, sub.display_name as subject_name, t.name as topic_name,
        exists (select 1 from material_versions v where v.material_id = any(s.source_material_ids) and v.detected_at > s.updated_at) as outdated
      from summaries s join subjects sub on sub.id = s.subject_id left join topics t on t.id = s.topic_id where s.id = ${id}`;
    const [{ tz }] = await tx`select coalesce((select timezone from user_preferences), 'Asia/Manila') as tz`;
    return s ? { s, tz: tz as string } : null;
  });
  if (!data) notFound();
  const { s, tz } = data;
  const coverage = (s.source_coverage ?? []) as Cov[];

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/subjects/${s.subject_id}?tab=summaries`} className="hover:text-ivory">
            {s.subject_name} · Summaries
          </Link>
        }
        title={s.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone="gold">{SUMMARY_MODES[s.mode as keyof typeof SUMMARY_MODES]?.label}</Badge>
            {s.topic_name && <span>{s.topic_name}</span>}
            <span>Updated {formatDateTime(s.updated_at, tz)}</span>
            {s.edited && <Badge>Edited by you</Badge>}
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            <ButtonLink href={`/summaries/${s.id}/edit`} size="sm">
              <Pencil className="size-3.5" /> Edit
            </ButtonLink>
            <a href={`/api/summaries/${s.id}/export`} className={buttonClass("secondary", "sm")}>
              <Download className="size-4" /> Export .md
            </a>
            <PrintButton />
            <ButtonLink href={`/generate?subject=${s.subject_id}&kind=quiz`} size="sm" variant="primary">
              Quiz me on this
            </ButtonLink>
          </div>
        }
      />

      {s.outdated && (
        <div className="mb-4 print:hidden">
          <Notice tone="warn" title="A source material changed after this summary was generated">
            Regenerate it to include the latest version.
          </Notice>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Card className="p-5 sm:p-8">
          <Markdown>{s.body_md}</Markdown>
        </Card>
        <aside className="flex flex-col gap-4 print:hidden">
          <Card className="p-4">
            <h2 className="text-sm font-semibold">Sources</h2>
            {coverage.length === 0 ? (
              <p className="mt-2 text-sm text-warn">Not based on a course document (general knowledge).</p>
            ) : (
              <ul className="mt-3 space-y-3 text-sm">
                {coverage.map((c) => (
                  <li key={c.ref}>
                    <span className="mr-1 font-mono text-xs text-gold">{c.ref}</span>
                    {c.materialId ? (
                      <Link href={`/materials/${c.materialId}`} className="text-ivory hover:text-gold">
                        {c.title}
                      </Link>
                    ) : (
                      <span className="text-ivory">{c.title}</span>
                    )}
                    <div className="mt-0.5 text-xs text-faint">
                      Used {c.usedLabels} ({c.usedParts} of {c.totalParts})
                    </div>
                    {c.partial && <Badge tone="warn" className="mt-1">Partially processed</Badge>}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-4 border-t border-line pt-3 text-xs text-faint">
              Citations like (S1, Page 3) point to these sources. Blocks marked “Supplementary” are the AI&apos;s own explanation, not from the source.
              {s.model && <> Generated with {s.model}.</>}
            </p>
          </Card>
          <Card className="p-4">
            <h2 className="text-sm font-semibold">Regenerate</h2>
            <p className="mt-1 text-xs text-muted">Replaces this summary&apos;s text using the same sources{s.edited ? " — your edits will be overwritten" : ""}.</p>
            <ActionForm action={generateSummaryAction} className="mt-3 flex flex-col gap-2">
              <input type="hidden" name="subjectId" value={s.subject_id} />
              <input type="hidden" name="topicId" value={s.topic_id ?? ""} />
              <input type="hidden" name="regenerateId" value={s.id} />
              {(s.source_material_ids as string[]).map((m) => (
                <input key={m} type="hidden" name="materialIds" value={m} />
              ))}
              <Select name="mode" defaultValue={s.mode} aria-label="Mode">
                {Object.entries(SUMMARY_MODES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </Select>
              <SubmitButton variant="secondary" size="sm" disabled={!aiAvailable()} pendingText="Regenerating…" confirm={s.edited ? "Your edits will be replaced. Continue?" : undefined}>
                <RefreshCw className="size-3.5" /> Regenerate
              </SubmitButton>
            </ActionForm>
          </Card>
          <Dialog title="Delete summary" trigger="Delete summary" triggerClassName={buttonClass("ghost", "sm", "self-start")}>
            <p className="mb-4 text-sm text-muted">This deletes the summary. Quizzes made from it are kept.</p>
            <form action={deleteSummary}>
              <input type="hidden" name="id" value={s.id} />
              <SubmitButton variant="danger">Delete</SubmitButton>
            </form>
          </Dialog>
        </aside>
      </div>
    </>
  );
}
