import { redirect } from "next/navigation";
import { BookOpen, CalendarClock, GraduationCap, Sparkles } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { Wordmark } from "@/components/brand";
import { ButtonLink } from "@/components/ui";

export default async function Landing() {
  if (await getCurrentUser()) redirect("/home");
  const points = [
    { icon: GraduationCap, title: "Your Classroom, organized", text: "Connect Google Classroom and your courses become subjects, with their materials in one library." },
    { icon: Sparkles, title: "Study from the real source", text: "Summaries, quizzes, and flashcards generated from the documents your teachers posted." },
    { icon: CalendarClock, title: "A plan, not a panic", text: "Exam plans and a daily list that fit the time you actually have." },
    { icon: BookOpen, title: "A patient tutor", text: "Step-by-step help with engineering problems, without skipping the algebra." },
  ];
  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col px-5 py-6 sm:px-8">
      <header className="flex items-center justify-between">
        <Wordmark />
        <ButtonLink href="/login" variant="ghost" size="sm">
          Sign in
        </ButtonLink>
      </header>
      <main className="flex flex-1 flex-col justify-center py-16">
        <p className="text-xs font-medium uppercase tracking-[0.3em] text-gold">Academic command center</p>
        <h1 className="mt-4 max-w-2xl text-3xl font-semibold leading-tight tracking-tight sm:text-5xl">
          Build mastery.
          <br />
          <span className="text-muted">One day at a time.</span>
        </h1>
        <div className="mt-8 flex flex-wrap gap-3">
          <ButtonLink href="/signup" variant="primary">
            Create your account
          </ButtonLink>
          <ButtonLink href="/login">I already have one</ButtonLink>
        </div>
        <ul className="mt-16 grid gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-2">
          {points.map(({ icon: Icon, title, text }) => (
            <li key={title} className="bg-graphite p-5">
              <Icon className="size-5 text-gold" strokeWidth={1.6} />
              <h2 className="mt-3 text-sm font-semibold">{title}</h2>
              <p className="mt-1 text-sm text-muted">{text}</p>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
