import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, ExternalLink, MessageSquare, Pencil, RefreshCw, Sparkles } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { isUuid } from "@/lib/data";
import { KIND_LABEL } from "@/lib/materials";
import { formatDateTime } from "@/lib/study/dates";
import { Badge, ButtonLink, Card, CardHeader, Field, Input, Notice, PageHeader, Select, buttonClass } from "@/components/ui";
import { Dialog, SubmitButton } from "@/components/client";
import { ActionForm } from "@/components/action-form";
import { Markdown } from "@/components/markdown";
import { PdfViewer } from "@/components/pdf-viewer";
import { StatusBadges } from "@/app/(app)/subjects/[id]/materials";
import { deleteMaterial, refreshDriveMaterial, updateMaterial } from "@/app/actions/materials";
import { SUMMARY_MODES } from "@/lib/ai/prompts";

export const metadata = { title: "Material" };

function youtubeId(url: string | null) {
  return url?.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{6,})/)?.[1] ?? null;
}

export default async function MaterialPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const data = await withUser(user.id, async (tx) => {
    const [m] = await tx`
      select m.*, s.display_name as subject_name, s.id as subject_id, t.name as topic_name,
        f.filename, f.size_bytes, f.mime_type as file_mime, c.pages, c.page_count, c.char_count, c.truncated,
        a.title as assignment_title
      from materials m join subjects s on s.id = m.subject_id left join topics t on t.id = m.topic_id
      left join material_files f on f.material_id = m.id left join material_contents c on c.material_id = m.id
      left join assignments a on a.id = m.assignment_id
      where m.id = ${id}`;
    if (!m) return null;
    if (!m.seen_by_user) await tx`update materials set seen_by_user = true where id = ${id}`;
    const [{ tz }] = await tx`select coalesce((select timezone from user_preferences), 'Asia/Manila') as tz`;
    return {
      m,
      tz: tz as string,
      topics: await tx`select id, name from topics where subject_id = ${m.subject_id} order by name`,
      summaries: await tx`select s.id, s.title, s.mode, s.updated_at,
          exists (select 1 from material_versions v where v.material_id = ${id} and v.detected_at > s.updated_at) as outdated
        from summaries s where ${id} = any(s.source_material_ids) order by s.updated_at desc`,
      quizzes: await tx`select q.id, q.title, q.created_at,
          exists (select 1 from material_versions v where v.material_id = ${id} and v.detected_at > q.created_at) as outdated
        from quizzes q where ${id} = any(q.source_material_ids) order by q.created_at desc`,
      decks: await tx`select d.id, d.name from flashcard_decks d where ${id} = any(d.source_material_ids) order by d.created_at desc`,
      lastChange: (await tx`select max(detected_at) as at from material_versions where material_id = ${id}`)[0].at,
    };
  });
  if (!data) notFound();
  const { m, tz, topics, summaries, quizzes, decks, lastChange } = data;

  const fileUrl = `/api/materials/${m.id}/file`;
  const hasFile = Boolean(m.filename);
  const isPdfFile = hasFile && m.file_mime === "application/pdf";
  const pages = (m.pages ?? []) as { label: string; text: string }[];
  const yt = m.kind === "video" ? youtubeId(m.source_url) : null;
  const readable = m.processing_status === "ready";
  const generateHref = `/generate?subject=${m.subject_id}&materials=${m.id}`;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/subjects/${m.subject_id}?tab=materials`} className="hover:text-ivory">
            {m.subject_name} · Materials
          </Link>
        }
        title={m.title}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{m.source_item_type === "courseWork" ? "Assignment attachment" : m.source_item_type === "announcement" ? "Announcement" : KIND_LABEL[m.kind]}</span>
            {m.topic_name && <span>· {m.topic_name}</span>}
            {m.posted_at && <span>· Posted {formatDateTime(m.posted_at, tz)}</span>}
            {m.source_updated_at && <span>· Updated {formatDateTime(m.source_updated_at, tz)}</span>}
            {m.due_at && <span className="text-warn">· Due {formatDateTime(m.due_at, tz)}</span>}
          </span>
        }
        actions={
          <>
            {m.source_url && (
              <a href={m.source_url} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "sm")}>
                <ExternalLink className="size-4" /> {m.origin === "imported" ? "Open in Google" : "Open link"}
              </a>
            )}
            {hasFile && (
              <a href={`${fileUrl}?download=1`} className={buttonClass("secondary", "sm")}>
                <Download className="size-4" /> Download
              </a>
            )}
            <ButtonLink href={`/study?subject=${m.subject_id}&material=${m.id}&mode=teach`} size="sm">
              <MessageSquare className="size-4" /> Explain this
            </ButtonLink>
            <ButtonLink href={generateHref} variant="primary" size="sm">
              <Sparkles className="size-4" /> Generate Study Pack
            </ButtonLink>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        <Badge tone={m.origin === "imported" ? "info" : "neutral"}>{m.origin === "imported" ? "Imported from Classroom" : m.origin === "note" ? "Your note" : "Your upload"}</Badge>
        <StatusBadges m={m} />
        {lastChange && <Badge tone="warn">Content changed {formatDateTime(lastChange, tz)}</Badge>}
      </div>

      {m.access_status === "permission_required" && (
        <div className="mb-4">
          <Notice tone="bad" title="Yaxha can't open this file">
            {m.processing_error ?? "Your Google account did not grant access to this file."} The title and link are shown, but no content has been read, so no summary can be generated from it.
            You can open it in Google, then upload a copy here.
          </Notice>
        </div>
      )}
      {m.access_status === "not_downloaded" && (
        <div className="mb-4">
          <Notice
            tone="info"
            title="Not downloaded yet"
            action={
              <ActionForm action={refreshDriveMaterial}>
                <input type="hidden" name="id" value={m.id} />
                <SubmitButton size="sm" variant="secondary" pendingText="Downloading…">
                  <RefreshCw className="size-4" /> Download now
                </SubmitButton>
              </ActionForm>
            }
          >
            This Drive file has been listed but its content has not been fetched. Download it to view it here and use it for study packs.
          </Notice>
        </div>
      )}
      {readable && m.processing_error && (
        <div className="mb-4">
          <Notice tone="warn">{m.processing_error}</Notice>
        </div>
      )}
      {!readable && (m.processing_status === "unsupported" || m.processing_status === "failed") && m.access_status === "ok" && (
        <div className="mb-4">
          <Notice tone="warn" title="Text could not be extracted">
            {m.processing_error} Study packs need readable text, so they can&apos;t be generated from this file.
          </Notice>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          {isPdfFile ? (
            <PdfViewer url={fileUrl} downloadUrl={`${fileUrl}?download=1`} title={m.title} />
          ) : hasFile && m.kind === "image" ? (
            <Card className="overflow-hidden p-2">
              <a href={fileUrl} target="_blank" rel="noopener">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={fileUrl} alt={m.title} className="mx-auto max-h-[75vh] w-auto rounded" />
              </a>
              <p className="mt-2 text-center text-xs text-faint">Select the image to open it full size.</p>
            </Card>
          ) : yt ? (
            <div className="aspect-video overflow-hidden rounded-card border border-line">
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${yt}`}
                title={m.title}
                className="size-full"
                allow="accelerometer; encrypted-media; picture-in-picture"
                allowFullScreen
              />
            </div>
          ) : m.drive_file_id && !hasFile && ["google_doc", "google_slides", "google_sheet", "pdf", "video", "other", "docx", "pptx", "image"].includes(m.kind) ? (
            <Card className="overflow-hidden">
              <iframe
                src={`https://drive.google.com/file/d/${m.drive_file_id}/preview`}
                title={m.title}
                className="h-[70vh] w-full bg-white"
                allow="autoplay"
              />
              <p className="border-t border-line px-4 py-2 text-xs text-faint">
                Google&apos;s preview. It shows only if this browser is signed in to a Google account that can open the file. Otherwise use Open in Google.
              </p>
            </Card>
          ) : m.kind === "link" || m.kind === "form" ? (
            <Card className="p-6">
              <p className="text-sm text-muted">This is a link to an external page. It opens in a new tab.</p>
              {m.source_url && (
                <a href={m.source_url} target="_blank" rel="noopener noreferrer" className={buttonClass("primary", "md", "mt-4")}>
                  <ExternalLink className="size-4" /> Open {m.kind === "form" ? "form" : "link"}
                </a>
              )}
              <p className="mt-3 break-all text-xs text-faint">{m.source_url}</p>
            </Card>
          ) : null}

          {m.description && m.kind !== "text" && (
            <Card>
              <CardHeader title={m.assignment_title ? "Assignment instructions" : "Post text"} />
              <div className="px-4 py-3 sm:px-5">
                <Markdown className="prose-yx text-sm">{m.description}</Markdown>
              </div>
            </Card>
          )}

          {pages.length > 0 && (
            <Card>
              <CardHeader
                title={m.kind === "text" ? "Content" : "Extracted text"}
                subtitle={
                  m.kind === "text"
                    ? undefined
                    : `${m.page_count} ${pages[0]?.label.split(" ")[0].toLowerCase() ?? "part"}${m.page_count === 1 ? "" : "s"} · ${Number(m.char_count).toLocaleString()} characters. This is exactly what the AI reads.`
                }
              />
              {m.kind === "text" ? (
                <div className="px-4 py-4 sm:px-5">
                  <Markdown>{pages.map((p) => p.text).join("\n\n")}</Markdown>
                </div>
              ) : (
                <details className="group">
                  <summary className="cursor-pointer px-4 py-3 text-sm text-gold sm:px-5">Show extracted text</summary>
                  <div className="max-h-[60vh] overflow-y-auto border-t border-line px-4 py-3 sm:px-5">
                    {pages.map((p) => (
                      <section key={p.label} className="mb-4">
                        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-faint">{p.label}</h3>
                        <p className="whitespace-pre-wrap text-sm text-muted">{p.text || "(no text on this page)"}</p>
                      </section>
                    ))}
                  </div>
                </details>
              )}
            </Card>
          )}
        </div>

        <aside className="flex flex-col gap-4">
          <Card className="p-4">
            <h2 className="text-sm font-semibold">Study packs from this material</h2>
            {summaries.length + quizzes.length + decks.length === 0 ? (
              <p className="mt-2 text-sm text-muted">None yet.</p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm">
                {summaries.map((s) => (
                  <li key={s.id}>
                    <Link href={`/summaries/${s.id}`} className="text-ivory hover:text-gold">
                      {s.title}
                    </Link>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      <Badge>{SUMMARY_MODES[s.mode as keyof typeof SUMMARY_MODES]?.label}</Badge>
                      {s.outdated && <Badge tone="warn">Source changed — regenerate</Badge>}
                    </div>
                  </li>
                ))}
                {quizzes.map((q) => (
                  <li key={q.id}>
                    <Link href={`/quizzes/${q.id}`} className="text-ivory hover:text-gold">
                      Quiz: {q.title}
                    </Link>
                    {q.outdated && (
                      <div className="mt-0.5">
                        <Badge tone="warn">Source changed</Badge>
                      </div>
                    )}
                  </li>
                ))}
                {decks.map((d) => (
                  <li key={d.id}>
                    <Link href={`/decks/${d.id}`} className="text-ivory hover:text-gold">
                      Flashcards: {d.name}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <ButtonLink href={generateHref} variant={readable ? "primary" : "secondary"} size="sm" className="mt-4 w-full">
              <Sparkles className="size-4" /> Generate Study Pack
            </ButtonLink>
          </Card>

          <Card className="p-4">
            <h2 className="text-sm font-semibold">Details</h2>
            <dl className="mt-3 space-y-2 text-xs">
              {m.filename && (
                <div>
                  <dt className="text-faint">File</dt>
                  <dd className="text-ivory">
                    {m.filename} · {Math.max(1, Math.round(m.size_bytes / 1024))} KB
                  </dd>
                </div>
              )}
              {m.assignment_title && (
                <div>
                  <dt className="text-faint">Assignment</dt>
                  <dd className="text-ivory">{m.assignment_title}</dd>
                </div>
              )}
              <div>
                <dt className="text-faint">Added to Yaxha</dt>
                <dd className="text-ivory">{formatDateTime(m.created_at, tz)}</dd>
              </div>
            </dl>
            <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
              <Dialog
                title="Edit material"
                trigger={
                  <>
                    <Pencil className="size-3.5" /> Edit
                  </>
                }
              >
                <ActionForm action={updateMaterial}>
                  <input type="hidden" name="id" value={m.id} />
                  <Field label="Title" htmlFor="m-title" hint={m.origin === "imported" ? "A sync may restore the Classroom title." : undefined}>
                    <Input id="m-title" name="title" defaultValue={m.title} required maxLength={300} />
                  </Field>
                  <Field label="Topic" htmlFor="m-topic">
                    <Select id="m-topic" name="topicId" defaultValue={m.topic_id ?? ""}>
                      <option value="">No topic</option>
                      {topics.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <SubmitButton>Save</SubmitButton>
                </ActionForm>
              </Dialog>
              {m.drive_file_id && m.access_status !== "not_downloaded" && (
                <ActionForm action={refreshDriveMaterial} className="flex flex-col gap-1">
                  <input type="hidden" name="id" value={m.id} />
                  <SubmitButton size="sm" variant="secondary" pendingText="Checking…">
                    <RefreshCw className="size-3.5" /> Check for updates
                  </SubmitButton>
                </ActionForm>
              )}
              {m.origin !== "imported" && (
                <form action={deleteMaterial}>
                  <input type="hidden" name="id" value={m.id} />
                  <SubmitButton variant="danger" size="sm" confirm="Delete this material? Study packs made from it are kept.">
                    Delete
                  </SubmitButton>
                </form>
              )}
            </div>
          </Card>
        </aside>
      </div>
    </>
  );
}
