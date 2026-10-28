// AI generation with a fake provider. These prove that prompts carry the real
// source text, outputs are validated before saving, and failures leave no records.
// They do NOT prove the behaviour of a real model.
import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql, withUser } from "@/lib/db";
import { storeFileAndExtract } from "@/lib/materials";
import { setProviderForTests, AiError, type AiRequest } from "@/lib/ai/provider";
import { generateFlashcards, generateQuiz, generateSummary } from "@/lib/ai/generate";
import { createUser, resetDb } from "./helpers";

const pdf = new Uint8Array(fs.readFileSync(path.join(__dirname, "fixtures", "engg-econ-lesson.pdf")));
const config = { count: 3, difficulty: "mixed" as const, types: ["multiple_choice", "numerical"], topics: "", instructions: "", includeSolutions: true };

let seen: AiRequest[] = [];
function fake(reply: string | ((r: AiRequest) => string)) {
  seen = [];
  setProviderForTests(async (req) => {
    seen.push(req);
    return { text: typeof reply === "string" ? reply : reply(req), inputTokens: 10, outputTokens: 10, model: "fake-model" };
  });
}

async function setup() {
  const u = await createUser();
  const ids = await withUser(u, async (tx) => {
    const [s] = await tx`insert into subjects (user_id, display_name) values (${u}, 'ENGG 404') returning id`;
    const [m] = await tx`insert into materials (user_id, subject_id, title, kind, origin) values (${u}, ${s.id}, 'Lesson 2', 'pdf', 'uploaded') returning id`;
    await storeFileAndExtract(tx, u, m.id, { filename: "lesson.pdf", mime: "application/pdf", kind: "pdf", bytes: pdf });
    return { subjectId: s.id as string, materialId: m.id as string };
  });
  return { u, ...ids };
}

beforeEach(resetDb);
afterEach(() => setProviderForTests(null));
afterAll(() => sql.end());

describe("AI generation (fake provider)", () => {
  it("summaries are built from the real extracted text and reused instead of regenerated", async () => {
    const { u, subjectId, materialId } = await setup();
    fake("# Compound interest reviewer\n\nF = P(1+i)^n (S1, Page 2)");
    const r = await generateSummary(u, { subjectId, materialIds: [materialId], mode: "detailed_reviewer" });
    expect(r.reused).toBe(false);
    const content = seen[0].messages[0].content;
    expect(content).toContain("14,693.28"); // a number that only exists in the fixture PDF
    expect(content).toContain("Page 2");
    const [row] = await withUser(u, (tx) => tx`select title, body_md, model, source_material_ids from summaries`);
    expect(row).toMatchObject({ title: "Compound interest reviewer", model: "fake-model" });
    expect(row.source_material_ids).toEqual([materialId]);
    const again = await generateSummary(u, { subjectId, materialIds: [materialId], mode: "detailed_reviewer" });
    expect(again).toMatchObject({ id: r.id, reused: true });
    expect(seen).toHaveLength(1); // no second AI call
  });

  it("quizzes keep only valid questions and re-check numeric answer keys", async () => {
    const { u, subjectId, materialId } = await setup();
    fake(
      "```json\n" +
        JSON.stringify({
          title: "Interest quiz",
          questions: [
            { type: "multiple_choice", prompt: "Which formula gives future worth?", choices: ["F=P(1+i)^n", "F=P/i"], answer: { choice: 0 } },
            { type: "numerical", prompt: "F of 10,000 at 8% for 5 years?", answer: { value: 14693.28, unit: "PHP", check: { expression: "10000*(1.08)^5" } } },
            { type: "numerical", prompt: "Wrong key: F of 10,000 at 8% for 5 years?", answer: { value: 15000, check: { expression: "10000*(1.08)^5" } } },
            { type: "multiple_choice", prompt: "Broken question with answer out of range", choices: ["a", "b"], answer: { choice: 7 } },
          ],
        }) +
        "\n```",
    );
    const r = await generateQuiz(u, { subjectId, materialIds: [materialId], config });
    expect(r.note).toMatch(/1 malformed question/);
    const qs = await withUser(u, (tx) => tx`select qtype, verification from quiz_questions where quiz_id = ${r.id} order by position`);
    expect(qs).toEqual([
      { qtype: "multiple_choice", verification: "not_applicable" },
      { qtype: "numerical", verification: "verified" },
      { qtype: "numerical", verification: "mismatch" },
    ]);
  });

  it("unusable AI output saves nothing", async () => {
    const { u, subjectId, materialId } = await setup();
    fake("Sorry, I can't help with that.");
    await expect(generateQuiz(u, { subjectId, materialIds: [materialId], config })).rejects.toBeInstanceOf(AiError);
    fake(JSON.stringify({ cards: [{ front: "", back: "" }] }));
    await expect(generateFlashcards(u, { subjectId, materialIds: [materialId], count: 5 })).rejects.toThrow(/usable flashcards/);
    const counts = await withUser(u, async (tx) => [
      (await tx`select count(*)::int as n from quizzes`)[0].n,
      (await tx`select count(*)::int as n from flashcard_decks`)[0].n,
    ]);
    expect(counts).toEqual([0, 0]);
    const usage = await withUser(u, (tx) => tx`select ok from ai_usage`);
    expect(usage.length).toBe(2);
  });

  it("flashcards link back to their source material", async () => {
    const { u, subjectId, materialId } = await setup();
    fake(JSON.stringify({ deck_name: "Interest", cards: [{ front: "Effective rate formula?", back: "ER = (1 + r/m)^m − 1", source_ref: "S1, Page 3" }] }));
    const r = await generateFlashcards(u, { subjectId, materialIds: [materialId], count: 5 });
    const [card] = await withUser(u, (tx) => tx`select source_material_id, source_ref from flashcards where deck_id = ${r.id}`);
    expect(card).toEqual({ source_material_id: materialId, source_ref: "S1, Page 3" });
  });

  it("materials from another subject or user cannot be used as sources", async () => {
    const a = await setup();
    const b = await setup();
    fake("# Should not include other user's file");
    await expect(generateSummary(a.u, { subjectId: a.subjectId, materialIds: [b.materialId], mode: "detailed_reviewer" })).rejects.toBeInstanceOf(AiError);
    expect(seen).toHaveLength(0);
  });

  it("without an API key, AI features report that they are not configured", async () => {
    setProviderForTests(null);
    const { u, subjectId, materialId } = await setup();
    await expect(generateSummary(u, { subjectId, materialIds: [materialId], mode: "detailed_reviewer" })).rejects.toThrow(/not configured/);
    expect(await withUser(u, (tx) => tx`select 1 from summaries`)).toHaveLength(0);
  });
});
