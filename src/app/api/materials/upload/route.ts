import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { env } from "@/lib/env";
import { validateUpload } from "@/lib/files/types";
import { storeFileAndExtract } from "@/lib/materials";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Upload one study file into a subject's library. */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > (env.maxUploadMb + 1) * 1024 * 1024) {
    return NextResponse.json({ error: `The file is larger than the ${env.maxUploadMb} MB limit.` }, { status: 413 });
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "The upload could not be read." }, { status: 400 });
  }
  const meta = z
    .object({ subjectId: z.string().uuid(), topicId: z.string().uuid().optional(), purpose: z.enum(["library", "tutor"]).default("library") })
    .safeParse({ subjectId: form.get("subjectId"), topicId: form.get("topicId") || undefined, purpose: form.get("purpose") || undefined });
  const file = form.get("file");
  if (!meta.success || !(file instanceof File)) return NextResponse.json({ error: "Choose a subject and a file." }, { status: 400 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const filename = file.name.replace(/[\\/]/g, "_").slice(0, 200) || "upload";
  const check = validateUpload(filename, bytes, env.maxUploadMb);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });
  if (meta.data.purpose === "tutor" && check.kind !== "image") return NextResponse.json({ error: "Attach an image (PNG, JPG, or WEBP) of the problem." }, { status: 400 });

  const result = await withUser(user.id, async (tx) => {
    const [subject] = await tx`select id from subjects where id = ${meta.data.subjectId}`;
    if (!subject) return null;
    const title = meta.data.purpose === "tutor" ? `Problem photo — ${new Date().toLocaleDateString("en-PH")}` : filename.replace(/\.[^.]+$/, "");
    const [m] = await tx`
      insert into materials (user_id, subject_id, topic_id, title, kind, origin, mime_type, processing_status, seen_by_user)
      values (${user.id}, ${meta.data.subjectId}, ${meta.data.topicId ?? null}, ${title}, ${check.kind}, 'uploaded', ${check.mime}, 'pending', true)
      returning id`;
    const r = await storeFileAndExtract(tx, user.id, m.id, { filename, mime: check.mime, kind: check.kind, bytes });
    return { id: m.id as string, ...r };
  });
  if (!result) return NextResponse.json({ error: "Subject not found." }, { status: 404 });
  return NextResponse.json({ id: result.id, status: result.status, message: result.error ?? null });
}
