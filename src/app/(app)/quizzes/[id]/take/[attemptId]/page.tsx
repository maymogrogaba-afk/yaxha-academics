import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { isUuid } from "@/lib/data";
import { PageHeader } from "@/components/ui";
import { QuizTaker } from "@/components/quiz-taker";

export const metadata = { title: "Quiz" };
export const maxDuration = 120;

export default async function TakePage({ params }: { params: Promise<{ id: string; attemptId: string }> }) {
  const user = await requireUser();
  const { id, attemptId } = await params;
  if (!isUuid(id) || !isUuid(attemptId)) notFound();
  const data = await withUser(user.id, async (tx) => {
    const [a] = await tx`select a.*, q.title, q.config from quiz_attempts a join quizzes q on q.id = a.quiz_id where a.id = ${attemptId} and a.quiz_id = ${id}`;
    if (!a) return null;
    // Answers and solutions are NOT sent to the browser while the quiz is in progress.
    const questions = await tx`select id, qtype, prompt, choices, topic_name, position from quiz_questions where id = any(${a.question_ids}::uuid[]) order by position`;
    return { a, questions };
  });
  if (!data) notFound();
  if (data.a.submitted_at) redirect(`/attempts/${attemptId}`);
  const deadline = data.a.time_limit_s ? new Date(data.a.started_at).getTime() + data.a.time_limit_s * 1000 : null;
  return (
    <>
      <PageHeader eyebrow={data.a.mode === "exam" ? "Exam simulation" : data.a.mode === "mistakes" ? "Mistakes review" : "Practice"} title={data.a.title} />
      <QuizTaker
        attemptId={attemptId}
        quizId={id}
        mode={data.a.mode}
        deadline={deadline}
        immediate={data.a.config?.feedback === "immediate"}
        questions={data.questions.map((q) => ({ id: q.id, qtype: q.qtype, prompt: q.prompt, choices: q.choices, topic_name: q.topic_name, position: q.position }))}
      />
    </>
  );
}
