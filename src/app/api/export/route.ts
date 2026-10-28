import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { withUser } from "@/lib/db";

/** Downloads all of your data as one JSON file (file bytes are excluded to keep it small). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const data = await withUser(user.id, async (tx) => {
    const out: Record<string, unknown> = { exported_at: new Date().toISOString(), account: { email: user.email } };
    const tables = [
      "profiles", "user_preferences", "subjects", "topics", "assignments", "materials", "material_contents", "exams", "exam_topics",
      "study_plans", "study_tasks", "study_sessions", "summaries", "quizzes", "quiz_questions", "quiz_attempts", "quiz_answers",
      "flashcard_decks", "flashcards", "flashcard_reviews", "topic_mastery", "tutor_sessions", "tutor_messages", "sync_runs",
    ];
    for (const t of tables) out[t] = await tx`select * from ${tx(t)}`;
    out.integrations = await tx`select provider, status, account_email, granted_scopes, last_sync_at from integrations`;
    return out;
  });
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="yaxha-academics-export-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
