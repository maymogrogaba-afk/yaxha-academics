"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { env } from "@/lib/env";
import { AiError, type AiMessage } from "@/lib/ai/provider";
import { runAi } from "@/lib/ai/run";
import { TUTOR_MODES, tutorSystem, type TutorMode } from "@/lib/ai/prompts";
import { loadSources, packSources } from "@/lib/ai/source";
import type { FormState } from "./auth";

const id = z.string().uuid();
const optId = z.union([id, z.literal("")]).transform((v) => v || null);

export async function createTutorSession(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = z
    .object({ mode: z.enum(Object.keys(TUTOR_MODES) as [TutorMode]), subjectId: id, topicId: optId, materialId: optId })
    .safeParse({ mode: form.get("mode"), subjectId: form.get("subjectId"), topicId: form.get("topicId") ?? "", materialId: form.get("materialId") ?? "" });
  if (!parsed.success) return { error: "Choose a mode and a subject." };
  const d = parsed.data;
  const [s] = await withUser(user.id, async (tx) => {
    const [subject] = await tx`select id from subjects where id = ${d.subjectId}`;
    if (!subject) throw new Error("Subject not found");
    return tx`insert into tutor_sessions (user_id, subject_id, topic_id, material_id, mode, title)
              values (${user.id}, ${d.subjectId}, ${d.topicId}, ${d.materialId}, ${d.mode}, ${TUTOR_MODES[d.mode].label}) returning id`;
  });
  redirect(`/study/${s.id}`);
}

export async function sendTutorMessage(sessionId: string, text: string, imageMaterialId: string | null) {
  const user = await requireUser();
  if (!id.safeParse(sessionId).success) return { error: "Invalid session." };
  const content = String(text ?? "").trim().slice(0, 8000);
  if (!content && !imageMaterialId) return { error: "Type a message first." };
  if (imageMaterialId && !id.safeParse(imageMaterialId).success) return { error: "Invalid image." };

  const ctx = await withUser(user.id, async (tx) => {
    const [s] = await tx`select ts.*, sub.display_name as subject_name, t.name as topic_name
      from tutor_sessions ts left join subjects sub on sub.id = ts.subject_id left join topics t on t.id = ts.topic_id where ts.id = ${sessionId}`;
    if (!s) return null;
    const history = await tx`select role, content, image_material_id from tutor_messages where session_id = ${sessionId} order by created_at desc limit 20`;
    let sourceText: string | null = null;
    if (s.material_id) {
      const { docs } = await loadSources(tx, [s.material_id]);
      if (docs.length) sourceText = packSources(docs, Math.min(env.ai.maxSourceChars, 30000)).text;
    }
    let image: { mime: string; base64: string } | undefined;
    if (imageMaterialId) {
      const [f] = await tx`select mime_type, bytes from material_files where material_id = ${imageMaterialId}`;
      if (f && /^image\/(png|jpeg|webp)$/.test(f.mime_type)) image = { mime: f.mime_type, base64: Buffer.from(f.bytes).toString("base64") };
    }
    return { s, history: history.reverse(), sourceText, image };
  });
  if (!ctx) return { error: "Session not found." };

  const messages: AiMessage[] = ctx.history.map((m) => ({ role: m.role, content: m.content + (m.image_material_id ? "\n[The student attached an image earlier.]" : "") }));
  messages.push({ role: "user", content: content || "Here is the problem.", image: ctx.image });
  // The API requires the conversation to start with a user turn.
  while (messages.length && messages[0].role !== "user") messages.shift();

  let reply: string;
  try {
    const res = await runAi(user.id, `tutor_${ctx.s.mode}`, {
      system: tutorSystem(ctx.s.mode, ctx.s.subject_name, ctx.s.topic_name, ctx.sourceText),
      messages,
      maxTokens: 3000,
      temperature: 0.4,
    });
    reply = res.text.trim() || "(The tutor returned an empty reply. Please try again.)";
  } catch (e) {
    return { error: e instanceof AiError ? e.message : "The tutor could not respond. Your message was not saved; please try again." };
  }

  // Both messages are saved together only after the AI succeeded.
  await withUser(user.id, async (tx) => {
    await tx`insert into tutor_messages (user_id, session_id, role, content, image_material_id) values (${user.id}, ${sessionId}, 'user', ${content || "Here is the problem."}, ${imageMaterialId})`;
    await tx`insert into tutor_messages (user_id, session_id, role, content) values (${user.id}, ${sessionId}, 'assistant', ${reply})`;
    const isFirst = ctx.history.length === 0;
    await tx`update tutor_sessions set updated_at = now() ${isFirst && content ? tx`, title = ${content.split("\n")[0].slice(0, 80)}` : tx``} where id = ${sessionId}`;
  });
  return { reply };
}

export async function toggleSaveSession(form: FormData) {
  const user = await requireUser();
  const sid = id.parse(form.get("id"));
  await withUser(user.id, (tx) => tx`update tutor_sessions set saved = not saved where id = ${sid}`);
  revalidatePath(`/study/${sid}`);
  revalidatePath("/study");
}

export async function deleteTutorSession(form: FormData) {
  const user = await requireUser();
  const sid = id.parse(form.get("id"));
  await withUser(user.id, (tx) => tx`delete from tutor_sessions where id = ${sid}`);
  redirect("/study");
}

/** Logs time spent in a tutoring session as a study session. */
export async function logTutorTime(form: FormData) {
  const user = await requireUser();
  const sid = id.parse(form.get("id"));
  const minutes = z.coerce.number().int().min(1).max(600).parse(form.get("minutes"));
  await withUser(user.id, async (tx) => {
    const [s] = await tx`select subject_id, topic_id from tutor_sessions where id = ${sid}`;
    if (s) await tx`insert into study_sessions (user_id, subject_id, topic_id, kind, duration_minutes, started_at, ended_at)
                    values (${user.id}, ${s.subject_id}, ${s.topic_id}, 'tutor', ${minutes}, now() - make_interval(mins => ${minutes}), now())`;
  });
  revalidatePath("/progress");
}
