import "server-only";
// Imports Google Classroom courses as subjects and their posts as library materials.
// Matching is always by Google's stable ids, never by names, so re-syncing never
// creates duplicates and renaming a subject never breaks the link.
import { withUser, type Tx } from "../db";
import { env } from "../env";
import { sha256 } from "../crypto";
import { storeFileAndExtract } from "../materials";
import { GoogleApiError, GoogleClient, type GCourse, type GDriveFile, type GMaterial } from "./classroom";
import { getAccessToken, getIntegration, hasDriveScope, GoogleAuthError } from "./oauth";
import type { MaterialKind } from "../files/types";

export type SyncIssue = { course?: string; item?: string; message: string };
export type SyncSummary = {
  status: "succeeded" | "partial" | "failed";
  coursesFound: number;
  subjectsCreated: number;
  itemsImported: number;
  itemsUpdated: number;
  filesDownloaded: number;
  issues: SyncIssue[];
};

const MAX_DOWNLOADS = Number(process.env.SYNC_MAX_DOWNLOADS ?? 15);
const MAX_UPDATE_CHECKS = Number(process.env.SYNC_MAX_UPDATE_CHECKS ?? 40);

type QueueItem = { materialId: string; fileId: string; title: string; course: string; hasFile: boolean };

/** Kind from a Drive mime type, or from the file name when the mime type is unknown. */
export function kindFromMime(mime: string | null | undefined, title = ""): MaterialKind {
  const m = mime ?? "";
  if (m === "application/vnd.google-apps.document") return "google_doc";
  if (m === "application/vnd.google-apps.spreadsheet") return "google_sheet";
  if (m === "application/vnd.google-apps.presentation") return "google_slides";
  if (m === "application/vnd.google-apps.form") return "form";
  if (m === "application/pdf") return "pdf";
  if (m.includes("wordprocessingml")) return "docx";
  if (m.includes("presentationml")) return "pptx";
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("text/")) return "text";
  const ext = title.toLowerCase().split(".").pop();
  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  if (ext === "pptx") return "pptx";
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext ?? "")) return "image";
  if (["mp4", "mov", "webm"].includes(ext ?? "")) return "video";
  if (ext === "txt" || ext === "md") return "text";
  return "other";
}

function dueAt(d?: { year: number; month: number; day: number }, t?: { hours?: number; minutes?: number }) {
  if (!d) return null;
  // Classroom due dates are in UTC.
  return new Date(Date.UTC(d.year, d.month - 1, d.day, t?.hours ?? 23, t?.minutes ?? 59));
}

type ItemType = "courseWorkMaterial" | "courseWork" | "announcement";

type MaterialSpec = {
  key: string;
  title: string;
  description: string | null;
  kind: MaterialKind;
  sourceUrl: string | null;
  driveFileId: string | null;
};

/** One library entry per attachment; posts without attachments become a text entry. */
export function materialsFor(courseId: string, itemType: ItemType, itemId: string, title: string, text: string | null, link: string | null, materials: GMaterial[] = []): MaterialSpec[] {
  const prefix = `gc:${courseId}:${itemType}:${itemId}`;
  const specs: MaterialSpec[] = [];
  for (const m of materials) {
    if (m.driveFile?.driveFile?.id) {
      const f = m.driveFile.driveFile;
      specs.push({ key: `${prefix}:drive:${f.id}`, title: f.title || title, description: text, kind: kindFromMime(null, f.title ?? ""), sourceUrl: f.alternateLink ?? null, driveFileId: f.id });
    } else if (m.youtubeVideo?.id) {
      const v = m.youtubeVideo;
      specs.push({ key: `${prefix}:yt:${v.id}`, title: v.title || title, description: text, kind: "video", sourceUrl: v.alternateLink ?? `https://www.youtube.com/watch?v=${v.id}`, driveFileId: null });
    } else if (m.link?.url) {
      specs.push({ key: `${prefix}:link:${sha256(m.link.url).slice(0, 16)}`, title: m.link.title || m.link.url, description: text, kind: "link", sourceUrl: m.link.url, driveFileId: null });
    } else if (m.form?.formUrl) {
      specs.push({ key: `${prefix}:form:${sha256(m.form.formUrl).slice(0, 16)}`, title: m.form.title || "Google Form", description: text, kind: "form", sourceUrl: m.form.formUrl, driveFileId: null });
    }
  }
  if (!specs.length && itemType !== "courseWork") {
    specs.push({ key: `${prefix}:post`, title, description: text, kind: "text", sourceUrl: link, driveFileId: null });
  }
  return specs;
}

export async function syncClassroom(userId: string, opts: { fetchImpl?: typeof fetch; token?: string } = {}): Promise<SyncSummary> {
  const integration = await getIntegration(userId);
  if (!integration) throw new GoogleAuthError("Google Classroom is not connected.", true);
  const driveAllowed = hasDriveScope(integration.granted_scopes);
  const summary: SyncSummary = { status: "succeeded", coursesFound: 0, subjectsCreated: 0, itemsImported: 0, itemsUpdated: 0, filesDownloaded: 0, issues: [] };

  const [run] = await withUser(userId, async (tx) => {
    await tx`update integrations set status = 'syncing' where id = ${integration.id}`;
    return tx`insert into sync_runs (user_id, integration_id) values (${userId}, ${integration.id}) returning id`;
  });

  try {
    const token = opts.token ?? (await getAccessToken(userId, opts.fetchImpl));
    const g = new GoogleClient(token, opts.fetchImpl);
    const courses = await g.courses();
    summary.coursesFound = courses.length;

    // Subjects: create or refresh source metadata; never overwrite a custom display name.
    await withUser(userId, async (tx) => {
      for (const c of courses) {
        const [row] = await tx`
          insert into subjects (user_id, display_name, source_provider, source_course_id, source_course_name, source_section,
                                source_description, source_course_state, source_link, source_status)
          values (${userId}, ${c.name.slice(0, 200)}, 'google_classroom', ${c.id}, ${c.name}, ${c.section ?? null},
                  ${c.description ?? c.descriptionHeading ?? null}, ${c.courseState ?? null}, ${c.alternateLink ?? null},
                  ${c.courseState === "ARCHIVED" ? "archived" : "active"})
          on conflict (user_id, source_provider, source_course_id) where source_course_id is not null do update set
            source_course_name = excluded.source_course_name,
            display_name = case when subjects.name_customized then subjects.display_name else excluded.display_name end,
            source_section = excluded.source_section, source_description = excluded.source_description,
            source_course_state = excluded.source_course_state, source_link = excluded.source_link,
            source_status = excluded.source_status
          returning (xmax = 0) as inserted`;
        if (row.inserted) summary.subjectsCreated++;
      }
      // Courses no longer returned by Google: keep everything, just mark them unavailable.
      await tx`update subjects set source_status = 'unavailable'
               where source_provider = 'google_classroom' and not (source_course_id = any(${courses.map((c) => c.id)}::text[]))`;
    });

    const downloadQueue: QueueItem[] = [];
    for (const course of courses) {
      try {
        await syncCourse(userId, g, course, summary, downloadQueue);
      } catch (e) {
        summary.issues.push({ course: course.name, message: describe(e) });
      }
    }

    // Files: download new Drive attachments first, then check already-stored ones for edits.
    // Both are bounded per sync so a sync finishes within hosting time limits.
    if (driveAllowed) {
      const fresh = downloadQueue.filter((q) => !q.hasFile);
      const stored = downloadQueue.filter((q) => q.hasFile);
      for (const item of fresh.slice(0, MAX_DOWNLOADS)) {
        if ((await fetchDriveFile(userId, g, item.materialId, item.fileId, summary, item.course)) === "downloaded") summary.filesDownloaded++;
      }
      for (const item of stored.slice(0, MAX_UPDATE_CHECKS)) {
        if ((await fetchDriveFile(userId, g, item.materialId, item.fileId, summary, item.course)) === "downloaded") summary.filesDownloaded++;
      }
      if (fresh.length > MAX_DOWNLOADS) {
        summary.issues.push({ message: `${fresh.length - MAX_DOWNLOADS} more file(s) will be downloaded on the next sync, or you can open them individually.` });
      }
    } else if (downloadQueue.some((q) => !q.hasFile)) {
      summary.issues.push({ message: `${downloadQueue.filter((q) => !q.hasFile).length} Drive file(s) were listed but not read, because Drive access was not granted. Reconnect with Drive access to read them.` });
    }

    summary.status = summary.issues.some((i) => i.course || i.item) ? "partial" : "succeeded";
  } catch (e) {
    summary.status = "failed";
    summary.issues.push({ message: describe(e) });
    if (e instanceof GoogleAuthError || (e instanceof GoogleApiError && e.status === 401)) {
      await withUser(userId, (tx) => tx`update integrations set status = 'authorization_required', last_error = ${describe(e)} where id = ${integration.id}`);
      await finishRun(userId, run.id, summary, integration.id, "authorization_required");
      return summary;
    }
  }
  const status = summary.status === "failed" ? "failed" : summary.status === "partial" ? "partial" : !driveAllowed ? "permission_required" : "synced";
  await finishRun(userId, run.id, summary, integration.id, status);
  return summary;
}

async function finishRun(userId: string, runId: string, s: SyncSummary, integrationId: string, status: string) {
  await withUser(userId, async (tx) => {
    await tx`update sync_runs set finished_at = now(), status = ${s.status}, courses_found = ${s.coursesFound}, subjects_created = ${s.subjectsCreated},
             items_imported = ${s.itemsImported}, items_updated = ${s.itemsUpdated}, issues = ${tx.json(s.issues)} where id = ${runId}`;
    await tx`update integrations set status = ${status}, last_sync_status = ${s.status},
             last_sync_at = case when ${s.status} <> 'failed' then now() else last_sync_at end,
             last_error = ${s.status === "failed" ? s.issues.map((i) => i.message).join(" ") : status === "authorization_required" ? s.issues[0]?.message ?? null : null}
             where id = ${integrationId}`;
  });
}

function describe(e: unknown) {
  if (e instanceof GoogleApiError) {
    if (e.status === 403) return `Permission denied by Google (${e.message}).`;
    if (e.status === 404) return "Not found or no longer accessible.";
    if (e.status === 429) return "Google's usage limit was reached. Try syncing again in a few minutes.";
    return e.message;
  }
  return (e as Error).message ?? String(e);
}

async function syncCourse(userId: string, g: GoogleClient, course: GCourse, summary: SyncSummary, downloadQueue: QueueItem[]) {
  // Each list is optional: a 403 on one (e.g. teacher list) should not block the rest.
  const safe = async <T,>(label: string, fn: () => Promise<T[]>): Promise<T[]> => {
    try {
      return await fn();
    } catch (e) {
      summary.issues.push({ course: course.name, message: `${label}: ${describe(e)}` });
      return [];
    }
  };
  const [topics, work, materials, announcements, submissions, teachers] = await Promise.all([
    safe("Topics", () => g.topics(course.id)),
    safe("Assignments", () => g.courseWork(course.id)),
    safe("Materials", () => g.courseWorkMaterials(course.id)),
    safe("Announcements", () => g.announcements(course.id)),
    safe("Submissions", () => g.mySubmissions(course.id)),
    g.teachers(course.id).catch(() => []),
  ]);
  const submissionBy = new Map(submissions.map((s) => [s.courseWorkId, s]));

  await withUser(userId, async (tx) => {
    const [subject] = await tx`select id from subjects where source_provider = 'google_classroom' and source_course_id = ${course.id}`;
    const teacherNames = teachers.map((t) => t.profile?.name?.fullName).filter(Boolean).join(", ");
    if (teacherNames) await tx`update subjects set source_teacher = ${teacherNames} where id = ${subject.id}`;

    const topicIds = new Map<string, string>();
    for (const t of topics) {
      const [row] = await tx`
        insert into topics (user_id, subject_id, name, source_topic_id) values (${userId}, ${subject.id}, ${t.name.slice(0, 200)}, ${t.topicId})
        on conflict (subject_id, source_topic_id) where source_topic_id is not null do update set name = excluded.name
        returning id`;
      topicIds.set(t.topicId, row.id);
    }

    const seenKeys: string[] = [];
    const seenAssignments: string[] = [];

    for (const w of work) {
      const key = `gc:${course.id}:courseWork:${w.id}`;
      seenAssignments.push(key);
      const sub = submissionBy.get(w.id);
      const [a] = await tx`
        insert into assignments (user_id, subject_id, topic_id, title, instructions, due_at, max_points, work_type, submission_state,
                                 origin, source_key, source_url, source_updated_at, completed)
        values (${userId}, ${subject.id}, ${w.topicId ? topicIds.get(w.topicId) ?? null : null}, ${w.title}, ${w.description ?? null},
                ${dueAt(w.dueDate, w.dueTime)}, ${w.maxPoints ?? null}, ${w.workType ?? null}, ${sub?.state ?? null}, 'imported', ${key},
                ${w.alternateLink ?? null}, ${w.updateTime ?? null}, ${sub?.state === "TURNED_IN" || sub?.state === "RETURNED"})
        on conflict (user_id, source_key) where source_key is not null do update set
          title = excluded.title, instructions = excluded.instructions, due_at = excluded.due_at, max_points = excluded.max_points,
          topic_id = excluded.topic_id, submission_state = excluded.submission_state, source_url = excluded.source_url,
          source_updated_at = excluded.source_updated_at, source_removed = false,
          completed = assignments.completed or excluded.completed
        returning id`;
      const specs = materialsFor(course.id, "courseWork", w.id, w.title, w.description ?? null, w.alternateLink ?? null, w.materials);
      for (const s of specs) await upsertMaterial(tx, userId, subject.id, w.topicId ? topicIds.get(w.topicId) ?? null : null, a.id, "courseWork", s, w, dueAt(w.dueDate, w.dueTime), summary, seenKeys, downloadQueue, course.name);
    }
    for (const m of materials) {
      const specs = materialsFor(course.id, "courseWorkMaterial", m.id, m.title, m.description ?? null, m.alternateLink ?? null, m.materials);
      for (const s of specs) await upsertMaterial(tx, userId, subject.id, m.topicId ? topicIds.get(m.topicId) ?? null : null, null, "courseWorkMaterial", s, m, null, summary, seenKeys, downloadQueue, course.name);
    }
    for (const an of announcements) {
      const text = an.text ?? "";
      const title = text.split("\n")[0].slice(0, 120) || "Announcement";
      const specs = materialsFor(course.id, "announcement", an.id, title, text, an.alternateLink ?? null, an.materials);
      for (const s of specs) await upsertMaterial(tx, userId, subject.id, null, null, "announcement", s, an, null, summary, seenKeys, downloadQueue, course.name);
    }

    // Items no longer visible in Classroom stay in the library, flagged as removed at the source.
    await tx`update materials set source_removed = true
             where subject_id = ${subject.id} and origin = 'imported' and not (source_key = any(${seenKeys}::text[]))`;
    await tx`update assignments set source_removed = true
             where subject_id = ${subject.id} and origin = 'imported' and not (source_key = any(${seenAssignments}::text[]))`;
  });
}

async function upsertMaterial(
  tx: Tx,
  userId: string,
  subjectId: string,
  topicId: string | null,
  assignmentId: string | null,
  itemType: ItemType,
  s: MaterialSpec,
  post: { creationTime?: string; updateTime?: string },
  due: Date | null,
  summary: SyncSummary,
  seenKeys: string[],
  downloadQueue: QueueItem[],
  courseName: string,
) {
  seenKeys.push(s.key);
  const isText = s.kind === "text" && !s.driveFileId;
  const [row] = await tx`
    insert into materials (user_id, subject_id, topic_id, assignment_id, title, description, kind, origin, source_item_type, source_key,
                           source_url, drive_file_id, posted_at, source_updated_at, due_at, access_status, processing_status)
    values (${userId}, ${subjectId}, ${topicId}, ${assignmentId}, ${s.title.slice(0, 300)}, ${s.description}, ${s.kind}, 'imported', ${itemType}, ${s.key},
            ${s.sourceUrl}, ${s.driveFileId}, ${post.creationTime ?? null}, ${post.updateTime ?? null}, ${due},
            ${s.driveFileId ? "not_downloaded" : "ok"}, ${isText ? "pending" : s.driveFileId ? "pending" : "not_applicable"})
    on conflict (user_id, source_key) where source_key is not null do update set
      title = excluded.title, description = excluded.description, topic_id = excluded.topic_id, assignment_id = excluded.assignment_id,
      source_url = excluded.source_url, source_updated_at = excluded.source_updated_at, due_at = excluded.due_at, source_removed = false
    returning id, (xmax = 0) as inserted, content_hash, access_status`;
  if (row.inserted) summary.itemsImported++;
  else summary.itemsUpdated++;

  // Posts without files: their own text is the content.
  if (isText && s.description) {
    const text = s.description;
    const hash = sha256(text);
    if (row.content_hash !== hash) {
      await tx`insert into material_contents (material_id, user_id, extractor, pages, char_count, page_count, content_hash)
               values (${row.id}, ${userId}, 'classroom-post', ${tx.json([{ label: "Post", text }])}, ${text.length}, 1, ${hash})
               on conflict (material_id) do update set pages = excluded.pages, char_count = excluded.char_count, content_hash = excluded.content_hash, extracted_at = now()`;
      if (row.content_hash) await tx`insert into material_versions (user_id, material_id, content_hash) values (${userId}, ${row.id}, ${hash})`;
      await tx`update materials set content_hash = ${hash}, processing_status = 'ready' where id = ${row.id}`;
    }
  } else if (isText) {
    await tx`update materials set processing_status = 'not_applicable' where id = ${row.id}`;
  }
  if (s.driveFileId) {
    const [f] = await tx`select 1 from material_files where material_id = ${row.id}`;
    downloadQueue.push({ materialId: row.id, fileId: s.driveFileId, title: s.title, course: courseName, hasFile: Boolean(f) && row.access_status === "ok" });
  }
}

const EXPORTS: Record<string, { mime: string; ext: string; kind: string }> = {
  "application/vnd.google-apps.document": { mime: "application/pdf", ext: "pdf", kind: "pdf" },
  "application/vnd.google-apps.presentation": { mime: "application/pdf", ext: "pdf", kind: "pdf" },
  "application/vnd.google-apps.spreadsheet": { mime: "text/csv", ext: "csv", kind: "text" },
};

/**
 * Downloads (or exports) one Drive file the user can access, stores it, and extracts its text.
 * Skips the download when Drive reports the file unchanged since the stored copy.
 * On failure the material records why, so the library can show it.
 */
export async function fetchDriveFile(
  userId: string,
  g: GoogleClient,
  materialId: string,
  fileId: string,
  summary?: SyncSummary,
  course?: string,
): Promise<"downloaded" | "unchanged" | "failed"> {
  const maxBytes = env.maxUploadMb * 1024 * 1024 * 2;
  let meta: GDriveFile;
  try {
    meta = await g.driveMeta(fileId);
  } catch (e) {
    const status = e instanceof GoogleApiError && (e.status === 403 || e.status === 404) ? "permission_required" : "error";
    await withUser(userId, (tx) => tx`update materials set access_status = ${status}, processing_status = 'failed',
        processing_error = ${status === "permission_required" ? "Your Google account does not have permission to open this file through the API. Open it in Google, or upload a copy." : describe(e)}
        where id = ${materialId}`);
    summary?.issues.push({ course, item: fileId, message: describe(e) });
    return "failed";
  }
  const kind = kindFromMime(meta.mimeType, meta.name);
  const [current] = await withUser(userId, (tx) => tx`
    select m.source_revision, m.access_status, (f.material_id is not null) as has_file
    from materials m left join material_files f on f.material_id = m.id where m.id = ${materialId}`);
  if (current?.has_file && current.access_status === "ok" && meta.modifiedTime && current.source_revision === meta.modifiedTime) return "unchanged";
  try {
    const exp = EXPORTS[meta.mimeType];
    let bytes: Uint8Array;
    let storeKind: string;
    let mime: string;
    let filename = meta.name;
    if (exp) {
      bytes = await g.driveExport(fileId, exp.mime, maxBytes);
      storeKind = exp.kind;
      mime = exp.mime;
      filename = `${meta.name}.${exp.ext}`;
    } else if (["pdf", "docx", "pptx", "image", "text"].includes(kind)) {
      bytes = await g.driveDownload(fileId, maxBytes);
      storeKind = kind;
      mime = meta.mimeType;
    } else {
      await withUser(userId, (tx) => tx`update materials set kind = ${kind}, mime_type = ${meta.mimeType}, access_status = 'unsupported',
          processing_status = 'unsupported', processing_error = 'This file type is shown with a link to the original; its content cannot be read here.' where id = ${materialId}`);
      return "failed";
    }
    await withUser(userId, async (tx) => {
      await tx`update materials set kind = ${kind}, mime_type = ${meta.mimeType}, title = coalesce(nullif(${meta.name}, ''), title),
               source_revision = ${meta.modifiedTime ?? null} where id = ${materialId}`;
      await storeFileAndExtract(tx, userId, materialId, { filename, mime, kind: storeKind, bytes });
    });
    return "downloaded";
  } catch (e) {
    const status = e instanceof GoogleApiError && e.status === 403 ? "permission_required" : "error";
    await withUser(userId, (tx) => tx`update materials set kind = ${kind}, access_status = ${status}, processing_status = 'failed', processing_error = ${describe(e)} where id = ${materialId}`);
    summary?.issues.push({ course, item: meta.name, message: describe(e) });
    return "failed";
  }
}
