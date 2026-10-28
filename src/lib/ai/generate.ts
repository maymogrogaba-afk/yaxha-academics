import "server-only";
// Study pack generation: summaries, quizzes, flashcards. The AI is called first;
// the database is only written after a valid result comes back.
import { z } from "zod";
import { withUser } from "../db";
import { env } from "../env";
import { sha256 } from "../crypto";
import { runAi, parseJsonReply } from "./run";
import { AiError } from "./provider";
import { chunkDocs, coverageNote, loadSources, packSources, totalChars, type Coverage } from "./source";
import { chunkNotesPrompt, flashcardPrompt, quizPrompt, summaryPrompt, type QuizConfig, type SummaryMode } from "./prompts";
import { verifyNumericAnswer, type NumericAnswer } from "../study/grading";

type SourceOpts = {
  subjectId: string;
  topicId?: string | null;
  materialIds: string[];
  summaryId?: string | null;
  pageFrom?: number | null;
  pageTo?: number | null;
};

async function subjectContext(userId: string, o: SourceOpts) {
  return withUser(userId, async (tx) => {
    const [subject] = await tx`select id, display_name from subjects where id = ${o.subjectId}`;
    if (!subject) throw new AiError("Subject not found.", "bad_output");
    const topic = o.topicId ? (await tx`select id, name from topics where id = ${o.topicId} and subject_id = ${o.subjectId}`)[0] : null;
    // Only materials that belong to this subject can be used.
    const owned = o.materialIds.length
      ? (await tx`select id from materials where id = any(${o.materialIds}::uuid[]) and subject_id = ${o.subjectId}`).map((r) => r.id as string)
      : [];
    const { docs, problems } = await loadSources(tx, owned, { summaryId: o.summaryId, pageFrom: o.pageFrom, pageTo: o.pageTo });
    return { subject, topic, docs, problems };
  });
}

function genKey(userId: string, kind: string, parts: unknown) {
  return sha256(JSON.stringify([userId, kind, parts]));
}

// ------------------------------------------------------------------ summaries
export async function generateSummary(
  userId: string,
  o: SourceOpts & { mode: SummaryMode; instructions?: string; regenerateId?: string | null },
): Promise<{ id: string; reused: boolean; note: string | null }> {
  const ctx = await subjectContext(userId, o);
  if (o.materialIds.length && !ctx.docs.length) {
    throw new AiError(`None of the selected materials could be read: ${ctx.problems.map((p) => `"${p.title}" — ${p.problem}`).join(" ")}`, "bad_output");
  }
  const budget = env.ai.maxSourceChars;
  const sourceHash = sha256(JSON.stringify(ctx.docs.map((d) => [d.materialId, d.summaryId, d.pages])));
  const key = genKey(userId, "summary", [o.subjectId, o.topicId ?? null, o.mode, sourceHash, o.instructions ?? ""]);

  if (!o.regenerateId) {
    const [existing] = await withUser(userId, (tx) => tx`select id from summaries where generation_key = ${key}`);
    if (existing) return { id: existing.id, reused: true, note: null };
  }

  const prompt = summaryPrompt(o.mode, ctx.subject.display_name, ctx.topic?.name ?? null, o.instructions ?? "");
  let sourceText = "";
  let coverage: Coverage[] = [];
  let multiPassNote: string | null = null;

  if (ctx.docs.length && totalChars(ctx.docs) > budget) {
    // Large source: condense each part into notes first, then write the final pack from all notes.
    const chunks = chunkDocs(ctx.docs, budget);
    const maxChunks = 4;
    const used = chunks.slice(0, maxChunks);
    const notes: string[] = [];
    for (const [i, chunk] of used.entries()) {
      const packed = packSources(chunk, budget);
      const np = chunkNotesPrompt(ctx.subject.display_name);
      const res = await runAi(userId, "summary_chunk", {
        system: np.system,
        maxTokens: 4000,
        messages: [{ role: "user", content: `${packed.text}\n\n${np.task} (part ${i + 1} of ${used.length})` }],
      });
      notes.push(`<notes part="${i + 1}">\n${res.text}\n</notes>`);
    }
    sourceText = notes.join("\n\n") + "\n\n(The notes above were condensed from the source documents and keep their (S#, Page n) citations.)";
    // Coverage: which parts made it into the processed chunks
    const usedPages = new Map<string, number>();
    for (const ch of used) for (const d of ch) usedPages.set(d.ref, (usedPages.get(d.ref) ?? 0) + d.pages.length);
    coverage = ctx.docs.map((d) => {
      const n = usedPages.get(d.ref) ?? 0;
      return {
        ref: d.ref,
        materialId: d.materialId,
        title: d.title,
        totalParts: d.pages.length,
        usedParts: n,
        usedLabels: n ? `${d.pages[0].label} – ${d.pages[n - 1].label}` : "nothing",
        partial: n < d.pages.length,
      };
    });
    multiPassNote = chunks.length > maxChunks ? `This source was too long to process completely; ${maxChunks} of ${chunks.length} parts were used. Choose a page range to cover the rest.` : null;
  } else if (ctx.docs.length) {
    const packed = packSources(ctx.docs, budget);
    sourceText = packed.text;
    coverage = packed.coverage;
  }

  const res = await runAi(userId, "summary", {
    system: prompt.system,
    maxTokens: o.mode === "quick_overview" ? 2000 : 8000,
    messages: [
      {
        role: "user",
        content: sourceText
          ? `${sourceText}\n\n${prompt.task}`
          : `${prompt.task}\n\nNo source document was provided. Write from standard course knowledge, and start with a one-line note saying it is not based on a course document.`,
      },
    ],
  });
  let body = res.text.trim();
  if (!body) throw new AiError("The AI returned an empty response. Please try again.", "bad_output");
  if (res.stopReason === "max_tokens" || res.stopReason === "length") body += "\n\n> **Note:** This response reached the length limit and may end abruptly.";
  const title = (body.match(/^#\s+(.+)$/m)?.[1] ?? `${ctx.topic?.name ?? ctx.subject.display_name} — reviewer`).slice(0, 160);
  const note = [coverageNote(coverage), multiPassNote, ctx.problems.length ? `Skipped unreadable: ${ctx.problems.map((p) => p.title).join(", ")}` : null]
    .filter(Boolean)
    .join(" ") || null;

  const id = await withUser(userId, async (tx) => {
    if (o.regenerateId) {
      const [row] = await tx`update summaries set body_md = ${body}, title = ${title}, mode = ${o.mode}, source_coverage = ${tx.json(coverage)},
          source_hash = ${sourceHash}, generation_key = null, model = ${res.model}, edited = false
        where id = ${o.regenerateId} returning id`;
      if (row) return row.id as string;
    }
    const [row] = await tx`
      insert into summaries (user_id, subject_id, topic_id, title, mode, body_md, source_material_ids, source_coverage, source_hash, generation_key, model)
      values (${userId}, ${o.subjectId}, ${o.topicId ?? null}, ${title}, ${o.mode}, ${body}, ${ctx.docs.filter((d) => d.materialId).map((d) => d.materialId!)}::uuid[],
              ${tx.json(coverage)}, ${sourceHash}, ${key}, ${res.model})
      on conflict (user_id, generation_key) where generation_key is not null do update set body_md = excluded.body_md
      returning id`;
    return row.id as string;
  });
  return { id, reused: false, note };
}

// ------------------------------------------------------------------ quizzes
const answerSchema = z.union([
  z.object({ choice: z.number().int().min(0) }),
  z.object({ value: z.boolean() }),
  z.object({
    value: z.number().finite(),
    unit: z.string().nullish(),
    tolerance_pct: z.number().positive().max(20).nullish(),
    check: z.object({ expression: z.string(), variables: z.record(z.string(), z.number()).optional() }).nullish(),
  }),
  z.object({ text: z.string().min(1) }),
]);

const questionSchema = z.object({
  type: z.enum(["multiple_choice", "true_false", "short_answer", "numerical", "formula", "multi_step"]),
  topic: z.string().nullish(),
  difficulty: z.string().nullish(),
  prompt: z.string().min(5),
  choices: z.array(z.string()).nullish(),
  answer: answerSchema,
  solution: z.string().nullish(),
  rubric: z.string().nullish(),
  source_ref: z.string().nullish(),
});

export function validateQuestions(raw: unknown[]) {
  const ok: z.infer<typeof questionSchema>[] = [];
  let dropped = 0;
  for (const q of raw) {
    const p = questionSchema.safeParse(q);
    if (!p.success) {
      dropped++;
      continue;
    }
    const v = p.data;
    if (v.type === "multiple_choice" && (!v.choices || v.choices.length < 2 || !("choice" in v.answer) || v.answer.choice >= v.choices.length)) {
      dropped++;
      continue;
    }
    if (v.type === "true_false" && !("value" in v.answer && typeof v.answer.value === "boolean")) {
      dropped++;
      continue;
    }
    if (v.type === "numerical" && !("value" in v.answer && typeof v.answer.value === "number")) {
      dropped++;
      continue;
    }
    ok.push(v);
  }
  return { questions: ok, dropped };
}

export async function generateQuiz(
  userId: string,
  o: SourceOpts & { config: QuizConfig; title?: string },
): Promise<{ id: string; reused: boolean; note: string | null }> {
  const ctx = await subjectContext(userId, o);
  if ((o.materialIds.length || o.summaryId) && !ctx.docs.length) {
    throw new AiError(`The selected sources could not be read: ${ctx.problems.map((p) => `"${p.title}" — ${p.problem}`).join(" ")}`, "bad_output");
  }
  const packed = packSources(ctx.docs, env.ai.maxSourceChars);
  const key = genKey(userId, "quiz", [o.subjectId, o.topicId ?? null, packed.hash, o.config]);
  const [existing] = await withUser(userId, (tx) => tx`select id from quizzes where generation_key = ${key}`);
  if (existing) return { id: existing.id, reused: true, note: null };

  const prompt = quizPrompt(ctx.subject.display_name + (ctx.topic ? ` — topic: ${ctx.topic.name}` : ""), o.config, ctx.docs.length > 0);
  const res = await runAi(userId, "quiz", {
    system: prompt.system,
    maxTokens: Math.min(16000, 1200 + o.config.count * 900),
    temperature: 0.4,
    messages: [{ role: "user", content: ctx.docs.length ? `${packed.text}\n\n${prompt.task}` : prompt.task }],
  });
  const parsed = parseJsonReply<{ title?: string; questions?: unknown[] }>(res.text);
  const { questions, dropped } = validateQuestions(Array.isArray(parsed.questions) ? parsed.questions : []);
  if (!questions.length) throw new AiError("The AI did not return any usable questions. Please try again.", "bad_output");

  const notes = [coverageNote(packed.coverage), dropped ? `${dropped} malformed question(s) were discarded.` : null].filter(Boolean).join(" ") || null;
  const id = await withUser(userId, async (tx) => {
    const topics = await tx`select id, name from topics where subject_id = ${o.subjectId}`;
    const [quiz] = await tx`
      insert into quizzes (user_id, subject_id, topic_id, title, config, source_material_ids, source_summary_id, source_coverage, source_hash, generation_key, model)
      values (${userId}, ${o.subjectId}, ${o.topicId ?? null}, ${(o.title || parsed.title || "Practice quiz").slice(0, 160)}, ${tx.json({ ...o.config, note: notes })},
              ${ctx.docs.filter((d) => d.materialId).map((d) => d.materialId!)}::uuid[], ${o.summaryId ?? null}, ${tx.json(packed.coverage)}, ${packed.hash}, ${key}, ${res.model})
      returning id`;
    for (const [i, q] of questions.entries()) {
      let verification = "not_applicable";
      let vnote: string | null = null;
      if ("value" in q.answer && typeof q.answer.value === "number") {
        const v = verifyNumericAnswer(q.answer as NumericAnswer);
        verification = v.status;
        vnote = v.note;
      }
      const topicMatch = q.topic ? topics.find((t) => t.name.toLowerCase() === q.topic!.toLowerCase()) : null;
      await tx`
        insert into quiz_questions (user_id, quiz_id, position, qtype, prompt, choices, answer, solution_md, rubric, topic_name, topic_id, difficulty, verification, verification_note)
        values (${userId}, ${quiz.id}, ${i + 1}, ${q.type}, ${q.prompt + (q.source_ref ? `\n\n*Source: ${q.source_ref}*` : "")},
                ${q.choices ? tx.json(q.choices) : null}, ${tx.json(q.answer)}, ${o.config.includeSolutions ? q.solution ?? "" : q.solution ?? ""},
                ${q.rubric ?? null}, ${q.topic ?? ctx.topic?.name ?? null}, ${topicMatch?.id ?? o.topicId ?? null}, ${q.difficulty ?? null}, ${verification}, ${vnote})`;
    }
    return quiz.id as string;
  });
  return { id, reused: false, note: notes };
}

// ------------------------------------------------------------------ flashcards
const cardSchema = z.object({ front: z.string().min(1), back: z.string().min(1), topic: z.string().nullish(), source_ref: z.string().nullish() });

export async function generateFlashcards(
  userId: string,
  o: SourceOpts & { count: number; deckName?: string },
): Promise<{ id: string; reused: boolean; note: string | null }> {
  const ctx = await subjectContext(userId, o);
  if ((o.materialIds.length || o.summaryId) && !ctx.docs.length) {
    throw new AiError(`The selected sources could not be read: ${ctx.problems.map((p) => `"${p.title}" — ${p.problem}`).join(" ")}`, "bad_output");
  }
  const packed = packSources(ctx.docs, env.ai.maxSourceChars);
  const key = genKey(userId, "deck", [o.subjectId, o.topicId ?? null, packed.hash, o.count]);
  const [existing] = await withUser(userId, (tx) => tx`select id from flashcard_decks where generation_key = ${key}`);
  if (existing) return { id: existing.id, reused: true, note: null };

  const prompt = flashcardPrompt(ctx.subject.display_name + (ctx.topic ? ` — topic: ${ctx.topic.name}` : ""), o.count, ctx.docs.length > 0);
  const res = await runAi(userId, "flashcards", {
    system: prompt.system,
    maxTokens: Math.min(12000, 500 + o.count * 250),
    messages: [{ role: "user", content: ctx.docs.length ? `${packed.text}\n\n${prompt.task}` : prompt.task }],
  });
  const parsed = parseJsonReply<{ deck_name?: string; cards?: unknown[] }>(res.text);
  const cards = (Array.isArray(parsed.cards) ? parsed.cards : []).map((c) => cardSchema.safeParse(c)).filter((r) => r.success).map((r) => r.data!);
  if (!cards.length) throw new AiError("The AI did not return any usable flashcards. Please try again.", "bad_output");
  const singleMaterial = ctx.docs.length === 1 ? ctx.docs[0].materialId : null;

  const id = await withUser(userId, async (tx) => {
    const [deck] = await tx`
      insert into flashcard_decks (user_id, subject_id, topic_id, name, source_material_ids, source_summary_id, generation_key)
      values (${userId}, ${o.subjectId}, ${o.topicId ?? null}, ${(o.deckName || parsed.deck_name || "Flashcards").slice(0, 160)},
              ${ctx.docs.filter((d) => d.materialId).map((d) => d.materialId!)}::uuid[], ${o.summaryId ?? null}, ${key})
      returning id`;
    for (const c of cards) {
      const ref = c.source_ref ?? null;
      const refDoc = ref ? ctx.docs.find((d) => ref.startsWith(d.ref)) : null;
      await tx`insert into flashcards (user_id, deck_id, front, back, topic_name, source_material_id, source_ref)
               values (${userId}, ${deck.id}, ${c.front}, ${c.back}, ${c.topic ?? null}, ${refDoc?.materialId ?? singleMaterial}, ${ref})`;
    }
    return deck.id as string;
  });
  return { id, reused: false, note: coverageNote(packed.coverage) };
}
