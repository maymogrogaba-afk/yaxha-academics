import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { extractContent } from "@/lib/files/extract";
import { validateUpload } from "@/lib/files/types";

const fixture = (f: string) => new Uint8Array(fs.readFileSync(path.join(__dirname, "fixtures", f)));

async function makePptx() {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types/>");
  zip.file("ppt/slides/slide1.xml", '<p:sld><a:p><a:r><a:t>Nominal &amp; effective rates</a:t></a:r></a:p><a:p><a:r><a:t>ER = (1 + r/m)^m - 1</a:t></a:r></a:p></p:sld>');
  zip.file("ppt/slides/slide2.xml", "<p:sld><a:p><a:r><a:t>Continuous compounding</a:t></a:r></a:p></p:sld>");
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}

describe("upload validation", () => {
  it("accepts real files and rejects disguised or oversized ones", () => {
    expect(validateUpload("lesson.pdf", fixture("engg-econ-lesson.pdf"), 15)).toMatchObject({ ok: true, kind: "pdf" });
    expect(validateUpload("notes.txt", new TextEncoder().encode("hello"), 15)).toMatchObject({ ok: true, kind: "text" });
    const fakePdf = validateUpload("virus.pdf", new TextEncoder().encode("MZ this is an exe"), 15);
    expect(fakePdf.ok).toBe(false);
    expect(validateUpload("script.exe", new Uint8Array([1, 2, 3]), 15).ok).toBe(false);
    expect(validateUpload("empty.pdf", new Uint8Array(), 15).ok).toBe(false);
    expect(validateUpload("big.pdf", new Uint8Array(2 * 1024 * 1024).fill(0x25), 1).ok).toBe(false);
    expect(validateUpload("bin.txt", new Uint8Array([0x41, 0, 0x42]), 15).ok).toBe(false);
  });
});

describe("text extraction", () => {
  it("extracts PDF text page by page", async () => {
    const r = await extractContent("pdf", fixture("engg-econ-lesson.pdf"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pages).toHaveLength(3);
    expect(r.pages[0].label).toBe("Page 1");
    expect(r.pages[1].text).toContain("14,693.28");
    expect(r.pages[2].text).toContain("Effective interest rate");
  });
  it("reports scanned (image-only) PDFs honestly instead of pretending", async () => {
    const r = await extractContent("pdf", fixture("scanned.pdf"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe("unsupported");
  });
  it("extracts PowerPoint slides with slide labels", async () => {
    const r = await extractContent("pptx", await makePptx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pages.map((p) => p.label)).toEqual(["Slide 1", "Slide 2"]);
    expect(r.pages[0].text).toContain("Nominal & effective rates");
  });
  it("fails gracefully on corrupt files", async () => {
    const r = await extractContent("docx", new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]));
    expect(r.ok).toBe(false);
    const p = await extractContent("pdf", new TextEncoder().encode("%PDF-1.4 garbage"));
    expect(p.ok).toBe(false);
  });
});
