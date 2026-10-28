"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { sha256 } from "@/lib/crypto";
import { GoogleClient } from "@/lib/google/classroom";
import { getAccessToken } from "@/lib/google/oauth";
import { fetchDriveFile } from "@/lib/google/sync";
import type { FormState } from "./auth";

const id = z.string().uuid();

export async function addNote(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = z
    .object({ subjectId: id, title: z.string().trim().min(1, "Give the note a title.").max(300), body: z.string().trim().min(1, "Write something first.").max(200_000), topicId: id.optional() })
    .safeParse({ subjectId: form.get("subjectId"), title: form.get("title"), body: form.get("body"), topicId: form.get("topicId") || undefined });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  const mid = await withUser(user.id, async (tx) => {
    const hash = sha256(d.body);
    const [m] = await tx`insert into materials (user_id, subject_id, topic_id, title, kind, origin, processing_status, content_hash, seen_by_user)
                         values (${user.id}, ${d.subjectId}, ${d.topicId ?? null}, ${d.title}, 'text', 'note', 'ready', ${hash}, true) returning id`;
    const pages = [];
    for (let i = 0; i < d.body.length; i += 4000) pages.push({ label: `Part ${pages.length + 1}`, text: d.body.slice(i, i + 4000) });
    await tx`insert into material_contents (material_id, user_id, extractor, pages, char_count, page_count, content_hash)
             values (${m.id}, ${user.id}, 'note', ${tx.json(pages)}, ${d.body.length}, ${pages.length}, ${hash})`;
    return m.id as string;
  });
  revalidatePath(`/subjects/${d.subjectId}`);
  redirect(`/materials/${mid}`);
}

export async function addLink(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = z
    .object({ subjectId: id, title: z.string().trim().max(300).optional(), url: z.string().trim().url("Enter a full link starting with https://").refine((u) => /^https?:\/\//i.test(u), "Only http and https links are allowed.") })
    .safeParse({ subjectId: form.get("subjectId"), title: form.get("title") || undefined, url: form.get("url") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  const yt = d.url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/);
  await withUser(user.id, (tx) => tx`
    insert into materials (user_id, subject_id, title, kind, origin, source_url, seen_by_user)
    values (${user.id}, ${d.subjectId}, ${d.title || d.url}, ${yt ? "video" : "link"}, 'uploaded', ${d.url}, true)`);
  revalidatePath(`/subjects/${d.subjectId}`);
  return { ok: "Link added." };
}

export async function updateMaterial(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = z
    .object({ id, title: z.string().trim().min(1).max(300), topicId: z.union([id, z.literal("")]) })
    .safeParse({ id: form.get("id"), title: form.get("title"), topicId: form.get("topicId") ?? "" });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  await withUser(user.id, (tx) => tx`update materials set title = ${parsed.data.title}, topic_id = ${parsed.data.topicId || null} where id = ${parsed.data.id}`);
  revalidatePath(`/materials/${parsed.data.id}`);
  return { ok: "Saved." };
}

/** Imported Classroom items cannot be deleted here (they would come back on sync); uploads and notes can. */
export async function deleteMaterial(form: FormData) {
  const user = await requireUser();
  const mid = id.parse(form.get("id"));
  const [row] = await withUser(user.id, (tx) => tx`delete from materials where id = ${mid} and origin <> 'imported' returning subject_id`);
  if (row) {
    revalidatePath(`/subjects/${row.subject_id}`);
    redirect(`/subjects/${row.subject_id}?tab=materials`);
  }
}

/** Re-downloads an imported Drive file now (e.g. after permissions changed). */
export async function refreshDriveMaterial(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const mid = id.parse(form.get("id"));
  const [m] = await withUser(user.id, (tx) => tx`select drive_file_id from materials where id = ${mid}`);
  if (!m?.drive_file_id) return { error: "This material is not a Google Drive file." };
  try {
    const token = await getAccessToken(user.id);
    const result = await fetchDriveFile(user.id, new GoogleClient(token), mid, m.drive_file_id);
    revalidatePath(`/materials/${mid}`);
    if (result === "failed") return { error: "The file still could not be read. See the status message on this page." };
    return { ok: result === "unchanged" ? "The stored copy is already up to date." : "File downloaded and processed." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function markMaterialSeen(mid: string) {
  const user = await requireUser();
  if (!id.safeParse(mid).success) return;
  await withUser(user.id, (tx) => tx`update materials set seen_by_user = true where id = ${mid} and not seen_by_user`);
}
