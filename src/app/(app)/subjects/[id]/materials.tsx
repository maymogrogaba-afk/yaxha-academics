import Link from "next/link";
import type { Row } from "postgres";
import { LayoutGrid, Link2, List, NotebookPen, Search } from "lucide-react";
import { withUser } from "@/lib/db";
import { isUuid } from "@/lib/data";
import { env } from "@/lib/env";
import { KIND_LABEL } from "@/lib/materials";
import { formatDateTime } from "@/lib/study/dates";
import { Badge, Button, ButtonLink, Card, EmptyState, Field, Input, Select, Textarea, cx } from "@/components/ui";
import { Dialog, SubmitButton } from "@/components/client";
import { ActionForm } from "@/components/action-form";
import { AutoSubmitForm } from "@/components/auto-submit";
import { MaterialIcon } from "@/components/material-icon";
import { UploadButton } from "@/components/upload";
import { addLink, addNote } from "@/app/actions/materials";

const PAGE_SIZE = 24;

export function StatusBadges({ m }: { m: Row }) {
  return (
    <>
      {m.source_removed && <Badge tone="warn">Removed from Classroom</Badge>}
      {m.access_status === "permission_required" && <Badge tone="bad">Permission required</Badge>}
      {m.access_status === "not_downloaded" && <Badge>Not downloaded yet</Badge>}
      {m.access_status === "error" && <Badge tone="bad">Could not open</Badge>}
      {m.processing_status === "ready" && <Badge tone="ok">Readable</Badge>}
      {m.processing_status === "unsupported" && m.access_status === "ok" && <Badge tone="warn" title={m.processing_error ?? ""}>Text not readable</Badge>}
      {m.processing_status === "failed" && m.access_status === "ok" && <Badge tone="bad" title={m.processing_error ?? ""}>Processing failed</Badge>}
    </>
  );
}

export async function MaterialsTab({ userId, subject, sp, tz }: { userId: string; subject: Row; sp: Record<string, string | undefined>; tz: string }) {
  const q = (sp.q ?? "").trim().slice(0, 100);
  const type = sp.type ?? "";
  const topic = sp.topic === "none" || isUuid(sp.topic) ? sp.topic! : "";
  const origin = sp.origin ?? "";
  const sort = sp.sort ?? "newest";
  const view = sp.view === "grid" ? "grid" : "list";
  const page = Math.max(1, Number(sp.page) || 1);

  const { rows, total, topics, kinds } = await withUser(userId, async (tx) => {
    const where = tx`m.subject_id = ${subject.id}
      ${q ? tx`and (m.title ilike ${"%" + q + "%"} or m.description ilike ${"%" + q + "%"} or exists (
            select 1 from material_contents c where c.material_id = m.id and c.pages::text ilike ${"%" + q + "%"}))` : tx``}
      ${type === "assignment" ? tx`and m.source_item_type = 'courseWork'` : type === "announcement" ? tx`and m.source_item_type = 'announcement'` : type ? tx`and m.kind = ${type}` : tx``}
      ${topic === "none" ? tx`and m.topic_id is null` : topic ? tx`and m.topic_id = ${topic}::uuid` : tx``}
      ${origin === "imported" ? tx`and m.origin = 'imported'` : origin === "mine" ? tx`and m.origin <> 'imported'` : tx``}`;
    const order =
      sort === "oldest" ? tx`coalesce(m.posted_at, m.created_at) asc` : sort === "az" ? tx`lower(m.title) asc` : tx`coalesce(m.posted_at, m.created_at) desc`;
    const rows = await tx`
      select m.id, m.title, m.kind, m.origin, m.source_item_type, m.posted_at, m.created_at, m.due_at, m.access_status, m.processing_status,
        m.processing_error, m.source_removed, m.seen_by_user, m.source_updated_at, t.name as topic_name,
        exists (select 1 from summaries s where m.id = any(s.source_material_ids)) as has_summary,
        exists (select 1 from quizzes z where m.id = any(z.source_material_ids)) as has_quiz,
        exists (select 1 from material_versions v where v.material_id = m.id and (
          exists (select 1 from summaries s where m.id = any(s.source_material_ids) and v.detected_at > s.updated_at) or
          exists (select 1 from quizzes z where m.id = any(z.source_material_ids) and v.detected_at > z.created_at))) as pack_outdated
      from materials m left join topics t on t.id = m.topic_id
      where ${where} order by ${order} limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`;
    const [{ n }] = await tx`select count(*)::int as n from materials m where ${where}`;
    return {
      rows,
      total: n as number,
      topics: await tx`select id, name from topics where subject_id = ${subject.id} order by name`,
      kinds: (await tx`select distinct kind from materials where subject_id = ${subject.id} order by kind`).map((r) => r.kind as string),
    };
  });
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const qs = (over: Record<string, string | number>) => {
    const p = new URLSearchParams({ tab: "materials", ...(q && { q }), ...(type && { type }), ...(topic && { topic }), ...(origin && { origin }), sort, view, page: String(page) });
    for (const [k, v] of Object.entries(over)) p.set(k, String(v));
    return `/subjects/${subject.id}?${p}`;
  };
  const filtered = Boolean(q || type || topic || origin);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <UploadButton subjectId={subject.id} maxMb={env.maxUploadMb} />
        <div className="flex flex-wrap gap-2">
          <Dialog
            title="Write a note"
            wide
            trigger={
              <>
                <NotebookPen className="size-4" /> New note
              </>
            }
          >
            <ActionForm action={addNote}>
              <input type="hidden" name="subjectId" value={subject.id} />
              <Field label="Title" htmlFor="note-title">
                <Input id="note-title" name="title" required maxLength={300} />
              </Field>
              <Field label="Topic" htmlFor="note-topic">
                <Select id="note-topic" name="topicId" defaultValue="">
                  <option value="">No topic</option>
                  {topics.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Note" htmlFor="note-body" hint="Notes are saved as study material, so you can generate summaries and quizzes from them. LaTeX like $x^2$ works.">
                <Textarea id="note-body" name="body" rows={10} required />
              </Field>
              <SubmitButton>Save note</SubmitButton>
            </ActionForm>
          </Dialog>
          <Dialog
            title="Add a link"
            trigger={
              <>
                <Link2 className="size-4" /> Add link
              </>
            }
          >
            <ActionForm action={addLink} resetOnSuccess>
              <input type="hidden" name="subjectId" value={subject.id} />
              <Field label="Link" htmlFor="link-url">
                <Input id="link-url" name="url" type="url" placeholder="https://" required />
              </Field>
              <Field label="Title (optional)" htmlFor="link-title">
                <Input id="link-title" name="title" maxLength={300} />
              </Field>
              <SubmitButton>Add link</SubmitButton>
            </ActionForm>
          </Dialog>
        </div>
      </div>

      <AutoSubmitForm className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <input type="hidden" name="tab" value="materials" />
        <input type="hidden" name="view" value={view} />
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
          <Input name="q" defaultValue={q} placeholder="Search materials, assignments, and lessons…" aria-label="Search materials" className="pl-9" />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Select name="type" defaultValue={type} aria-label="Filter by type" className="sm:w-40">
            <option value="">All types</option>
            <option value="assignment">Assignments</option>
            <option value="announcement">Announcements</option>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k] ?? k}
              </option>
            ))}
          </Select>
          <Select name="topic" defaultValue={topic} aria-label="Filter by topic" className="sm:w-44">
            <option value="">All topics</option>
            <option value="none">No topic</option>
            {topics.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
          <Select name="origin" defaultValue={origin} aria-label="Filter by source" className="sm:w-40">
            <option value="">All sources</option>
            <option value="imported">From Classroom</option>
            <option value="mine">Added by me</option>
          </Select>
          <Select name="sort" defaultValue={sort} aria-label="Sort" className="sm:w-36">
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="az">A–Z</option>
          </Select>
        </div>
        <div className="flex gap-1 self-end lg:self-auto">
          <Button type="submit" size="sm" variant="ghost" className="sr-only">
            Search
          </Button>
          <ButtonLink href={qs({ view: "list" })} size="sm" variant={view === "list" ? "secondary" : "ghost"} aria-label="List view">
            <List className="size-4" />
          </ButtonLink>
          <ButtonLink href={qs({ view: "grid" })} size="sm" variant={view === "grid" ? "secondary" : "ghost"} aria-label="Grid view">
            <LayoutGrid className="size-4" />
          </ButtonLink>
        </div>
      </AutoSubmitForm>

      <p className="text-xs text-faint">
        {total} item{total === 1 ? "" : "s"}
        {filtered && (
          <>
            {" "}
            ·{" "}
            <Link href={`/subjects/${subject.id}?tab=materials`} className="text-gold hover:underline">
              Clear filters
            </Link>
          </>
        )}
      </p>

      {rows.length === 0 ? (
        <EmptyState title={filtered ? "Nothing matches these filters" : "No materials yet"}>
          {filtered
            ? "Try a different search or clear the filters."
            : subject.source_provider === "google_classroom"
              ? "Sync Google Classroom to import this class's materials, or upload your own files."
              : "Upload PDFs, Word or PowerPoint files, images, or write a note."}
        </EmptyState>
      ) : view === "grid" ? (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((m) => (
            <li key={m.id}>
              <Link href={`/materials/${m.id}`} className="block h-full">
                <Card className="flex h-full flex-col p-4 transition-colors hover:border-line-strong">
                  <div className="flex items-center gap-2 text-faint">
                    <MaterialIcon kind={m.kind} className="size-5 text-gold" />
                    <span className="text-xs">{m.source_item_type === "courseWork" ? "Assignment" : m.source_item_type === "announcement" ? "Announcement" : KIND_LABEL[m.kind]}</span>
                    {!m.seen_by_user && m.origin === "imported" && <Badge tone="gold">New</Badge>}
                  </div>
                  <h3 className="mt-2 line-clamp-2 text-sm font-medium text-ivory">{m.title}</h3>
                  <p className="mt-1 text-xs text-faint">{m.topic_name ?? "No topic"}</p>
                  <div className="mt-auto flex flex-wrap gap-1 pt-3">
                    <MetaBadges m={m} />
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {rows.map((m) => (
              <li key={m.id}>
                <Link href={`/materials/${m.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-raised/40 sm:px-5">
                  <MaterialIcon kind={m.kind} className="mt-0.5 size-5 shrink-0 text-gold" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={cx("truncate text-sm", m.seen_by_user || m.origin !== "imported" ? "text-ivory" : "font-medium text-ivory")}>{m.title}</span>
                      {!m.seen_by_user && m.origin === "imported" && <Badge tone="gold">New</Badge>}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-faint">
                      <span>{m.source_item_type === "courseWork" ? "Assignment" : m.source_item_type === "announcement" ? "Announcement" : KIND_LABEL[m.kind]}</span>
                      {m.topic_name && <span>· {m.topic_name}</span>}
                      <span>· {formatDateTime(m.posted_at ?? m.created_at, tz)}</span>
                      {m.due_at && <span className="text-warn">· Due {formatDateTime(m.due_at, tz)}</span>}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      <MetaBadges m={m} />
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {pages > 1 && (
        <nav className="flex items-center justify-between text-sm" aria-label="Pagination">
          {page > 1 ? <ButtonLink href={qs({ page: page - 1 })} size="sm">Previous</ButtonLink> : <span />}
          <span className="text-muted">
            Page {page} of {pages}
          </span>
          {page < pages ? <ButtonLink href={qs({ page: page + 1 })} size="sm">Next</ButtonLink> : <span />}
        </nav>
      )}
    </div>
  );
}

function MetaBadges({ m }: { m: Row }) {
  return (
    <>
      <Badge tone={m.origin === "imported" ? "info" : "neutral"}>{m.origin === "imported" ? "Classroom" : m.origin === "note" ? "My note" : "My upload"}</Badge>
      <StatusBadges m={m} />
      {m.has_summary && <Badge tone="gold">Summary</Badge>}
      {m.has_quiz && <Badge tone="gold">Quiz</Badge>}
      {m.pack_outdated && <Badge tone="warn">Changed since study pack</Badge>}
    </>
  );
}
