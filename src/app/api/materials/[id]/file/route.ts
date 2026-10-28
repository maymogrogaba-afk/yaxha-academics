import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { isUuid } from "@/lib/data";

export const runtime = "nodejs";

/** Streams a stored file to its owner only. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const [f] = await withUser(user.id, (tx) => tx`select filename, mime_type, bytes from material_files where material_id = ${id}`);
  if (!f) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const download = new URL(req.url).searchParams.get("download") === "1";
  const safeName = String(f.filename).replace(/[^\w.\- ()]/g, "_");
  const inlineSafe = /^(application\/pdf|image\/(png|jpeg|webp)|text\/(plain|markdown|csv))$/.test(f.mime_type);
  return new NextResponse(new Uint8Array(f.bytes), {
    headers: {
      "content-type": f.mime_type.startsWith("text/") ? `${f.mime_type}; charset=utf-8` : f.mime_type,
      "content-disposition": `${download || !inlineSafe ? "attachment" : "inline"}; filename="${safeName}"`,
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
      // Browsers' built-in PDF viewers do not run inside a sandbox, so only other types get one.
      ...(f.mime_type === "application/pdf" ? {} : { "content-security-policy": "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'" }),
    },
  });
}
