import Link from "next/link";
import { notFound } from "next/navigation";
import { Bookmark, Trash2 } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { isUuid } from "@/lib/data";
import { aiAvailable } from "@/lib/ai/provider";
import { TUTOR_MODES, type TutorMode } from "@/lib/ai/prompts";
import { Badge, Input, PageHeader } from "@/components/ui";
import { Dialog, SubmitButton } from "@/components/client";
import { TutorChat } from "@/components/tutor-chat";
import { deleteTutorSession, logTutorTime, toggleSaveSession } from "@/app/actions/tutor";

export const metadata = { title: "Study session" };
export const maxDuration = 120;

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const data = await withUser(user.id, async (tx) => {
    const [s] = await tx`select ts.*, sub.display_name as subject_name, t.name as topic_name, m.title as material_title
      from tutor_sessions ts left join subjects sub on sub.id = ts.subject_id left join topics t on t.id = ts.topic_id
      left join materials m on m.id = ts.material_id where ts.id = ${id}`;
    if (!s) return null;
    return { s, messages: await tx`select id, role, content, image_material_id from tutor_messages where session_id = ${id} order by created_at` };
  });
  if (!data) notFound();
  const { s, messages } = data;
  const mode = TUTOR_MODES[s.mode as TutorMode];
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/study" className="hover:text-ivory">AI Study Room</Link>}
        title={s.title}
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge tone="gold">{mode.label}</Badge>
            {s.subject_name && <Badge>{s.subject_name}</Badge>}
            {s.topic_name && <Badge>{s.topic_name}</Badge>}
            {s.material_title && (
              <Link href={`/materials/${s.material_id}`}>
                <Badge tone="info">Context: {s.material_title}</Badge>
              </Link>
            )}
          </span>
        }
        actions={
          <>
            <form action={toggleSaveSession}>
              <input type="hidden" name="id" value={s.id} />
              <SubmitButton size="sm" variant={s.saved ? "secondary" : "ghost"}>
                <Bookmark className="size-3.5" /> {s.saved ? "Saved" : "Save session"}
              </SubmitButton>
            </form>
            <Dialog title="Log study time" trigger="Log time">
              <form action={logTutorTime} className="flex flex-col gap-3">
                <input type="hidden" name="id" value={s.id} />
                <label className="text-xs text-muted" htmlFor="log-min">
                  Minutes spent on this session
                </label>
                <Input id="log-min" name="minutes" type="number" min={1} max={600} defaultValue={25} />
                <SubmitButton>Log time</SubmitButton>
              </form>
            </Dialog>
            <form action={deleteTutorSession}>
              <input type="hidden" name="id" value={s.id} />
              <SubmitButton size="sm" variant="ghost" confirm="Delete this session?">
                <Trash2 className="size-3.5" />
                <span className="sr-only">Delete session</span>
              </SubmitButton>
            </form>
          </>
        }
      />
      <TutorChat
        sessionId={s.id}
        subjectId={s.subject_id}
        mode={s.mode}
        placeholder={mode.placeholder}
        aiReady={aiAvailable()}
        initial={messages.map((m) => ({ id: m.id, role: m.role, content: m.content, imageId: m.image_material_id }))}
      />
    </>
  );
}
