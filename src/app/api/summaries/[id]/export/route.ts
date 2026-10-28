import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { isUuid } from "@/lib/data";

/** Downloads a summary as a Markdown file (opens in any text editor, Obsidian, Notion, etc.). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const [s] = await withUser(user.id, (tx) => tx`select s.title, s.body_md, s.source_coverage, sub.display_name from summaries s join subjects sub on sub.id = s.subject_id where s.id = ${id}`);
  if (!s) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const sources = (s.source_coverage ?? []).map((c: { ref: string; title: string; usedLabels: string; partial: boolean }) => `- ${c.ref}: ${c.title} (${c.usedLabels}${c.partial ? ", partial" : ""})`).join("\n");
  const body = `${s.body_md}\n\n---\nSubject: ${s.display_name}\n${sources ? `Sources:\n${sources}\n` : ""}Exported from Yaxha Academics.\n`;
  const name = String(s.title).replace(/[^\w\- ]/g, "").slice(0, 80) || "summary";
  return new NextResponse(body, {
    headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="${name}.md"` },
  });
}
