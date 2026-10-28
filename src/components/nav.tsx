"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  CalendarClock,
  ChartLine,
  GraduationCap,
  House,
  LogOut,
  Menu,
  Settings,
  Sparkles,
} from "lucide-react";
import { cx } from "./ui";
import { Wordmark } from "./brand";

export const NAV = [
  { href: "/home", label: "Home", icon: House },
  { href: "/subjects", label: "My Subjects", icon: BookOpen },
  { href: "/study", label: "AI Study Room", icon: Sparkles },
  { href: "/exams", label: "Exam Planner", icon: CalendarClock },
  { href: "/classroom", label: "Google Classroom", icon: GraduationCap },
  { href: "/progress", label: "Progress", icon: ChartLine },
  { href: "/settings", label: "Settings", icon: Settings },
];

function useActive() {
  const path = usePathname();
  return (href: string) => path === href || path.startsWith(href + "/");
}

export function Sidebar({ userName, signOut }: { userName: string; signOut: () => Promise<void> }) {
  const isActive = useActive();
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line bg-obsidian px-3 py-5 lg:flex">
      <Link href="/home" className="mb-8 px-2" aria-label="Yaxha Academics home">
        <Wordmark />
      </Link>
      <nav aria-label="Main" className="flex flex-1 flex-col gap-0.5">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cx(
                "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                active ? "bg-graphite text-ivory" : "text-muted hover:bg-graphite/60 hover:text-ivory",
              )}
            >
              <Icon className={cx("size-4 shrink-0", active ? "text-gold" : "text-faint group-hover:text-muted")} strokeWidth={1.75} />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-4 border-t border-line pt-4">
        <div className="truncate px-3 text-xs text-muted" title={userName}>
          {userName}
        </div>
        <form action={signOut}>
          <button className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-faint hover:bg-graphite/60 hover:text-ivory">
            <LogOut className="size-4" strokeWidth={1.75} /> Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}

export function MobileNav({ signOut }: { signOut: () => Promise<void> }) {
  const isActive = useActive();
  const primary = NAV.slice(0, 4);
  const more = NAV.slice(4);
  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-obsidian/95 px-4 backdrop-blur lg:hidden">
        <Link href="/home" aria-label="Yaxha Academics home">
          <Wordmark compact />
        </Link>
        <details className="relative">
          <summary className="flex size-10 cursor-pointer list-none items-center justify-center rounded-lg text-muted hover:bg-graphite [&::-webkit-details-marker]:hidden" aria-label="More navigation">
            <Menu className="size-5" />
          </summary>
          <div className="absolute right-0 top-12 z-40 w-56 rounded-card border border-line bg-graphite p-1.5 shadow-xl">
            {more.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} className={cx("flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm", isActive(href) ? "text-ivory" : "text-muted hover:text-ivory")}>
                <Icon className="size-4 text-faint" /> {label}
              </Link>
            ))}
            <form action={signOut}>
              <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted hover:text-ivory">
                <LogOut className="size-4 text-faint" /> Sign out
              </button>
            </form>
          </div>
        </details>
      </header>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-obsidian/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        {primary.map(({ href, label, icon: Icon }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cx("flex flex-col items-center gap-1 py-2.5 text-[11px]", active ? "text-gold" : "text-muted")}
            >
              <Icon className="size-5" strokeWidth={1.75} />
              {label.replace("AI ", "").replace("My ", "").replace(" Planner", "s")}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
