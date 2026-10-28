import Link from "next/link";
import { Wordmark } from "@/components/brand";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <Link href="/" className="mb-8" aria-label="Yaxha Academics">
        <Wordmark />
      </Link>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
