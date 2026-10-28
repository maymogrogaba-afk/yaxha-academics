import Link from "next/link";
import type { Row } from "postgres";
import { Check, Play } from "lucide-react";
import { taskHref } from "@/lib/study/plans";
import { minutesLabel } from "@/lib/study/dates";
import { Badge, buttonClass, cx } from "./ui";
import { SubmitButton } from "./client";
import { completeTask, rescheduleTask, skipTask, undoTask } from "@/app/actions/tasks";

const KIND_LABEL: Record<string, string> = {
  learn: "Learn",
  practice: "Practice",
  review: "Review",
  flashcards: "Flashcards",
  mock_exam: "Mock exam",
  assignment: "Assignment",
  custom: "Task",
};

function Hidden({ id, name, value }: { id: string; name?: string; value?: string }) {
  return (
    <>
      <input type="hidden" name="id" value={id} />
      {name && <input type="hidden" name={name} value={value} />}
    </>
  );
}

/** One study task with its actions. Used on Home and in exam plans. */
export function TaskRow({ t, showDate = false }: { t: Row; showDate?: boolean }) {
  const done = t.status === "done";
  const missed = t.status === "missed";
  const skipped = t.status === "skipped";
  return (
    <li className={cx("flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:px-5", (done || skipped) && "opacity-60")}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cx("text-sm text-ivory", done && "line-through")}>{t.title}</span>
          {t.priority >= 4 && !done && <Badge tone="gold">High priority</Badge>}
          {missed && <Badge tone="warn">Missed</Badge>}
          {skipped && <Badge>Skipped</Badge>}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-2 text-xs text-faint">
          {t.subject_name && <span>{t.subject_name}</span>}
          {t.topic_name && <span>· {t.topic_name}</span>}
          <span>· {KIND_LABEL[t.kind] ?? t.kind}</span>
          <span>· {minutesLabel(t.duration_minutes)}</span>
          {showDate && <span>· {t.scheduled_date}</span>}
          {t.rescheduled_from && <span>· moved from {String(t.rescheduled_from).slice(0, 10)}</span>}
        </div>
        {t.reason && <p className="mt-1 text-xs text-muted">{t.reason}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {done ? (
          <form action={undoTask}>
            <Hidden id={t.id} />
            <SubmitButton size="sm" variant="ghost">
              Undo
            </SubmitButton>
          </form>
        ) : missed ? (
          <>
            <form action={rescheduleTask}>
              <Hidden id={t.id} name="to" value="today" />
              <SubmitButton size="sm" variant="secondary">
                Do today
              </SubmitButton>
            </form>
            <form action={rescheduleTask}>
              <Hidden id={t.id} name="to" value="tomorrow" />
              <SubmitButton size="sm" variant="ghost">
                Tomorrow
              </SubmitButton>
            </form>
            <form action={skipTask}>
              <Hidden id={t.id} />
              <SubmitButton size="sm" variant="ghost">
                Let it go
              </SubmitButton>
            </form>
          </>
        ) : skipped ? null : (
          <>
            <Link href={taskHref(t as never)} className={buttonClass("primary", "sm")}>
              <Play className="size-3.5" /> Start
            </Link>
            <form action={completeTask}>
              <Hidden id={t.id} />
              <SubmitButton size="sm" variant="secondary">
                <Check className="size-3.5" /> Done
              </SubmitButton>
            </form>
            <form action={rescheduleTask}>
              <Hidden id={t.id} name="to" value="tomorrow" />
              <SubmitButton size="sm" variant="ghost">
                Later
              </SubmitButton>
            </form>
            <form action={skipTask}>
              <Hidden id={t.id} />
              <SubmitButton size="sm" variant="ghost">
                Skip
              </SubmitButton>
            </form>
          </>
        )}
      </div>
    </li>
  );
}
