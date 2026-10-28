import "server-only";
import type { Tx } from "./db";
import { sha256 } from "./crypto";
import { extractContent } from "./files/extract";

/**
 * Stores a file for a material and extracts its text. Marks the material as
 * ready / unsupported / failed so the library always shows the true state.
 * Returns true when the content changed compared to what was stored before.
 */
export async function storeFileAndExtract(
  tx: Tx,
  userId: string,
  materialId: string,
  file: { filename: string; mime: string; kind: string; bytes: Uint8Array },
): Promise<{ changed: boolean; status: string; error?: string }> {
  const hash = sha256(Buffer.from(file.bytes));
  const [prev] = await tx`select content_hash from materials where id = ${materialId}`;
  const changed = Boolean(prev?.content_hash && prev.content_hash !== hash);

  await tx`
    insert into material_files (material_id, user_id, filename, mime_type, size_bytes, sha256, bytes)
    values (${materialId}, ${userId}, ${file.filename}, ${file.mime}, ${file.bytes.length}, ${hash}, ${Buffer.from(file.bytes)})
    on conflict (material_id) do update set filename = excluded.filename, mime_type = excluded.mime_type,
      size_bytes = excluded.size_bytes, sha256 = excluded.sha256, bytes = excluded.bytes, created_at = now()`;

  if (prev?.content_hash === hash) {
    // Same bytes as before: keep the existing extraction.
    await tx`update materials set access_status = 'ok' where id = ${materialId}`;
    const [m] = await tx`select processing_status from materials where id = ${materialId}`;
    return { changed: false, status: m.processing_status };
  }

  const result = await extractContent(file.kind, file.bytes);
  if (result.ok) {
    const chars = result.pages.reduce((s, p) => s + p.text.length, 0);
    await tx`
      insert into material_contents (material_id, user_id, extractor, pages, char_count, page_count, truncated, content_hash)
      values (${materialId}, ${userId}, ${result.extractor}, ${tx.json(result.pages)}, ${chars}, ${result.pages.length}, ${Boolean(result.note)}, ${hash})
      on conflict (material_id) do update set extractor = excluded.extractor, pages = excluded.pages, char_count = excluded.char_count,
        page_count = excluded.page_count, truncated = excluded.truncated, content_hash = excluded.content_hash, extracted_at = now()`;
    await tx`update materials set processing_status = 'ready', processing_error = ${result.note ?? null},
             access_status = 'ok', content_hash = ${hash} where id = ${materialId}`;
  } else {
    await tx`delete from material_contents where material_id = ${materialId}`;
    await tx`update materials set processing_status = ${result.status}, processing_error = ${result.error},
             access_status = 'ok', content_hash = ${hash} where id = ${materialId}`;
  }
  if (changed) {
    await tx`insert into material_versions (user_id, material_id, content_hash) values (${userId}, ${materialId}, ${hash})`;
  }
  return { changed, status: result.ok ? "ready" : result.status, error: result.ok ? undefined : result.error };
}

export const KIND_LABEL: Record<string, string> = {
  pdf: "PDF",
  google_doc: "Google Doc",
  google_sheet: "Google Sheet",
  google_slides: "Google Slides",
  docx: "Word",
  pptx: "PowerPoint",
  image: "Image",
  video: "Video",
  link: "Link",
  text: "Text",
  form: "Form",
  other: "File",
};
