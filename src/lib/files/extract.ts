import "server-only";
// Turns a file into plain text, keeping page/slide labels so AI answers can cite them.
import JSZip from "jszip";

export type ExtractedPage = { label: string; text: string };
export type Extraction =
  | { ok: true; extractor: string; pages: ExtractedPage[]; note?: string }
  | { ok: false; status: "unsupported" | "failed"; error: string };

const MAX_CHARS = 2_000_000; // hard ceiling per document to protect the server
const TIMEOUT_MS = 45_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Processing took longer than ${ms / 1000} seconds`)), ms);
    p.then((v) => (clearTimeout(t), resolve(v)), (e) => (clearTimeout(t), reject(e)));
  });
}

function clean(s: string) {
  return s.replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function extractPdf(bytes: Uint8Array): Promise<Extraction> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = (text as string[]).map((t, i) => ({ label: `Page ${i + 1}`, text: clean(t) }));
  const chars = pages.reduce((s, p) => s + p.text.length, 0);
  if (chars < 20 * Math.max(1, pages.length) && chars < 200) {
    return {
      ok: false,
      status: "unsupported",
      error:
        "This PDF has little or no selectable text, so it is probably scanned images. Text recognition (OCR) for scanned PDFs is not set up in this version. You can still view it, or upload a text-based copy.",
    };
  }
  return { ok: true, extractor: "unpdf", pages };
}

async function extractDocx(bytes: Uint8Array): Promise<Extraction> {
  const mammoth = await import("mammoth");
  const res = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  const text = clean(res.value);
  if (!text) return { ok: false, status: "failed", error: "The Word document contains no readable text." };
  // Word files have no fixed pages, so split into numbered sections of ~3000 characters.
  const pages: ExtractedPage[] = [];
  const paras = text.split(/\n\n+/);
  let buf = "";
  for (const p of paras) {
    if (buf.length + p.length > 3000 && buf) {
      pages.push({ label: `Section ${pages.length + 1}`, text: buf.trim() });
      buf = "";
    }
    buf += p + "\n\n";
  }
  if (buf.trim()) pages.push({ label: `Section ${pages.length + 1}`, text: buf.trim() });
  return { ok: true, extractor: "mammoth", pages };
}

async function extractPptx(bytes: Uint8Array): Promise<Extraction> {
  const zip = await JSZip.loadAsync(bytes);
  const slideFiles = Object.keys(zip.files)
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => Number(a.match(/(\d+)/)![1]) - Number(b.match(/(\d+)/)![1]));
  if (!slideFiles.length) return { ok: false, status: "failed", error: "No slides were found in this presentation." };
  const pages: ExtractedPage[] = [];
  for (const f of slideFiles) {
    const xml = await zip.file(f)!.async("string");
    const paras = xml.split(/<\/a:p>/).map((p) => [...p.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => decodeXml(m[1])).join(""));
    const n = Number(f.match(/slide(\d+)\.xml/)![1]);
    let text = paras.filter(Boolean).join("\n");
    const notesFile = zip.file(`ppt/notesSlides/notesSlide${n}.xml`);
    if (notesFile) {
      const notes = [...(await notesFile.async("string")).matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => decodeXml(m[1])).join(" ");
      if (notes.trim() && !/^\d+$/.test(notes.trim())) text += `\n[Speaker notes] ${notes.trim()}`;
    }
    pages.push({ label: `Slide ${n}`, text: clean(text) });
  }
  if (!pages.some((p) => p.text)) return { ok: false, status: "unsupported", error: "The slides contain no text (they may be images only)." };
  return { ok: true, extractor: "pptx-xml", pages };
}

function decodeXml(s: string) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function extractText(bytes: Uint8Array): Extraction {
  const text = clean(new TextDecoder("utf-8").decode(bytes));
  if (!text) return { ok: false, status: "failed", error: "The file is empty." };
  const pages: ExtractedPage[] = [];
  for (let i = 0; i < text.length; i += 4000) pages.push({ label: `Part ${pages.length + 1}`, text: text.slice(i, i + 4000) });
  return { ok: true, extractor: "text", pages };
}

/** `kind` is the material kind (pdf, docx, pptx, text, image, ...). */
export async function extractContent(kind: string, bytes: Uint8Array): Promise<Extraction> {
  try {
    let result: Extraction;
    if (kind === "pdf") result = await withTimeout(extractPdf(bytes), TIMEOUT_MS);
    else if (kind === "docx") result = await withTimeout(extractDocx(bytes), TIMEOUT_MS);
    else if (kind === "pptx") result = await withTimeout(extractPptx(bytes), TIMEOUT_MS);
    else if (kind === "text") result = extractText(bytes);
    else if (kind === "image")
      return {
        ok: false,
        status: "unsupported",
        error: "Images are not converted to text in the library. You can view them, and the AI Study Room can read an image of a problem directly when AI is configured.",
      };
    else return { ok: false, status: "unsupported", error: "This file type cannot be read as text." };
    if (result.ok) {
      let total = 0;
      const kept: ExtractedPage[] = [];
      for (const p of result.pages) {
        if (total + p.text.length > MAX_CHARS) {
          result.note = `Only the first ${kept.length} of ${result.pages.length} parts were stored because the document is extremely large.`;
          break;
        }
        total += p.text.length;
        kept.push(p);
      }
      result.pages = kept;
    }
    return result;
  } catch (e) {
    const msg = (e as Error).message || "Unknown error";
    return { ok: false, status: "failed", error: `Could not read this file: ${msg.slice(0, 200)}. It may be corrupt or password-protected.` };
  }
}
