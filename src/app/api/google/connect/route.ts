import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { buildAuthUrl, GoogleAuthError } from "@/lib/google/oauth";

/** Starts Google's consent screen. Yaxha never sees your Google password. */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(`${env.appUrl}/login`);
  const includeDrive = new URL(req.url).searchParams.get("drive") !== "0";
  try {
    return NextResponse.redirect(await buildAuthUrl(user.id, includeDrive));
  } catch (e) {
    const msg = e instanceof GoogleAuthError ? e.message : "Could not start Google sign-in.";
    return NextResponse.redirect(`${env.appUrl}/classroom?error=${encodeURIComponent(msg)}`);
  }
}
