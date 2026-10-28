import "server-only";
// Gathers the real text of the selected materials for an AI request, and records
// exactly which parts were used so the app can disclose partial processing.
import type { Tx } from "../db";
import { sha256 } from "../crypto";

export type SourceDoc = {
  ref: string; // S1, S2, ...
  materialId: string | null;
  summaryId?: string;
  title: string;
  pages: { label: string; text: string }[];
};

export type Coverage = {
  ref: string;
  materialId: string | null;
  title: string;
  totalParts: number;
  usedParts: number;
  usedLabels: string; // e.g. "Page 1–12"
  partial: boolean;
};

export type SourceProblem = { materialId: string; title: string; problem: string };

export async function loadSources(
  tx: Tx,
  materialIds: string[],
  opts: { summaryId?: string | null; pageFrom?: number | null; pageTo?: number | null } = {},
): Promise<{ docs: SourceDoc[]; problems: SourceProblem[] }> {
  const docs: SourceDoc[] = [];
  const problems: SourceProblem[] = [];
  if (materialIds.length) {
    const rows = await tx`
      select m.id, m.title, m.processing_status, m.processing_error, m.access_status, c.pages
      from materials m left join material_contents c on c.material_id = m.id
      where m.id = any(${materialIds}::uuid[])`;
    for (const id of materialIds) {
      const r = rows.find((x) => x.id === id);
      if (!r) continue;
      if (!r.pages || r.processing_status !== "ready") {
        problems.push({
          materialId: r.id,
          title: r.title,
          problem:
            r.access_status === "permission_required"
              ? "Yaxha does not have permission to read this file. Open it in Google, or upload a copy."
              : r.processing_error || "The text of this material has not been extracted, so it cannot be used as a source.",
        });
        continue;
      }
      let pages = r.pages as { label: string; text: string }[];
      if (opts.pageFrom || opts.pageTo) {
        const from = Math.max(1, opts.pageFrom ?? 1);
        const to = Math.min(pages.length, opts.pageTo ?? pages.length);
        pages = pages.slice(from - 1, to);
      }
      docs.push({ ref: `S${docs.length + 1}`, materialId: r.id, title: r.title, pages });
    }
  }
  if (opts.summaryId) {
    const [s] = await tx`select id, title, body_md from summaries where id = ${opts.summaryId}`;
    if (s) docs.push({ ref: `S${docs.length + 1}`, materialId: null, summaryId: s.id, title: `Saved summary: ${s.title}`, pages: [{ label: "Summary", text: s.body_md }] });
  }
  return { docs, problems };
}

function labelRange(pages: { label: string }[]) {
  if (!pages.length) return "nothing";
  if (pages.length === 1) return pages[0].label;
  return `${pages[0].label} – ${pages[pages.length - 1].label}`;
}

/**
 * Formats sources for the prompt within a character budget. Documents share the
 * budget; anything that does not fit is reported in `coverage` (never silently dropped).
 */
export function packSources(docs: SourceDoc[], budget: number): { text: string; coverage: Coverage[]; hash: string } {
  const perDoc = Math.floor(budget / Math.max(1, docs.length));
  const parts: string[] = [];
  const coverage: Coverage[] = [];
  for (const d of docs) {
    let used = 0;
    const kept: typeof d.pages = [];
    for (const p of d.pages) {
      if (used + p.text.length > perDoc && kept.length) break;
      kept.push(p.text.length > perDoc ? { ...p, text: p.text.slice(0, perDoc) } : p);
      used += Math.min(p.text.length, perDoc);
    }
    const partial = kept.length < d.pages.length || kept.some((k, i) => k.text.length < d.pages[i].text.length);
    coverage.push({ ref: d.ref, materialId: d.materialId, title: d.title, totalParts: d.pages.length, usedParts: kept.length, usedLabels: labelRange(kept), partial });
    parts.push(`<source ref="${d.ref}" title="${d.title.replace(/"/g, "'")}">\n${kept.map((p) => `[${p.label}]\n${p.text}`).join("\n\n")}\n</source>`);
  }
  const text = parts.join("\n\n");
  return { text, coverage, hash: sha256(text) };
}

export function totalChars(docs: SourceDoc[]) {
  return docs.reduce((s, d) => s + d.pages.reduce((a, p) => a + p.text.length, 0), 0);
}

/** Splits documents into chunks (each under `size` characters) for multi-pass summarising. */
export function chunkDocs(docs: SourceDoc[], size: number): SourceDoc[][] {
  const chunks: SourceDoc[][] = [];
  let current: SourceDoc[] = [];
  let used = 0;
  for (const d of docs) {
    let pages: SourceDoc["pages"] = [];
    for (const p of d.pages) {
      if (used + p.text.length > size && (pages.length || current.length)) {
        if (pages.length) current.push({ ...d, pages });
        chunks.push(current);
        current = [];
        pages = [];
        used = 0;
      }
      pages.push(p.text.length > size ? { ...p, text: p.text.slice(0, size) } : p);
      used += Math.min(p.text.length, size);
    }
    if (pages.length) current.push({ ...d, pages });
  }
  if (current.length) chunks.push(current);
  return chunks;
}

export function coverageNote(coverage: Coverage[]): string | null {
  const partial = coverage.filter((c) => c.partial);
  if (!partial.length) return null;
  return partial.map((c) => `"${c.title}": used ${c.usedLabels} (${c.usedParts} of ${c.totalParts} parts)`).join("; ");
}
