// Supported upload types, recognised by extension AND by the file's first bytes.
export type MaterialKind =
  | "pdf" | "google_doc" | "google_sheet" | "google_slides" | "docx" | "pptx"
  | "image" | "video" | "link" | "text" | "form" | "other";

export const UPLOAD_TYPES: Record<string, { kind: MaterialKind; mime: string }> = {
  pdf: { kind: "pdf", mime: "application/pdf" },
  docx: { kind: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  pptx: { kind: "pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
  txt: { kind: "text", mime: "text/plain" },
  md: { kind: "text", mime: "text/markdown" },
  png: { kind: "image", mime: "image/png" },
  jpg: { kind: "image", mime: "image/jpeg" },
  jpeg: { kind: "image", mime: "image/jpeg" },
  webp: { kind: "image", mime: "image/webp" },
};

export const ACCEPT_ATTR = ".pdf,.docx,.pptx,.txt,.md,.png,.jpg,.jpeg,.webp";

/** Checks the "magic bytes" so a renamed file cannot pretend to be another type. */
export function sniffMatches(ext: string, bytes: Uint8Array): boolean {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  switch (ext) {
    case "pdf":
      return starts(0x25, 0x50, 0x44, 0x46); // %PDF
    case "docx":
    case "pptx":
      return starts(0x50, 0x4b, 0x03, 0x04); // ZIP container
    case "png":
      return starts(0x89, 0x50, 0x4e, 0x47);
    case "jpg":
    case "jpeg":
      return starts(0xff, 0xd8, 0xff);
    case "webp":
      return starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45;
    case "txt":
    case "md": {
      // Reject binary data: no NUL bytes in the first 4 KB and valid UTF-8.
      const head = bytes.slice(0, 4096);
      if (head.includes(0)) return false;
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(head.length < bytes.length ? bytes.slice(0, 4096 - 4) : head);
        return true;
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
}

export function validateUpload(filename: string, bytes: Uint8Array, maxMb: number): { ok: true; ext: string; kind: MaterialKind; mime: string } | { ok: false; error: string } {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  const type = UPLOAD_TYPES[ext];
  if (!type) return { ok: false, error: `".${ext}" files are not supported. Use PDF, DOCX, PPTX, TXT, MD, PNG, JPG, or WEBP.` };
  if (bytes.length === 0) return { ok: false, error: "The file is empty." };
  if (bytes.length > maxMb * 1024 * 1024) return { ok: false, error: `The file is larger than the ${maxMb} MB limit.` };
  if (!sniffMatches(ext, bytes)) return { ok: false, error: `The file's contents do not look like a real .${ext} file. It may be corrupt or renamed.` };
  return { ok: true, ext, kind: type.kind, mime: type.mime };
}
