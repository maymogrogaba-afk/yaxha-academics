import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { handleCallback } from "@/lib/google/oauth";

/** Google sends the user back here after they approve (or decline) access. */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(`${env.appUrl}/login`);
  const url = new URL(req.url);
  const back = (q: string) => NextResponse.redirect(`${env.appUrl}/classroom?${q}`);
  const error = url.searchParams.get("error");
  if (error) return back(`error=${encodeURIComponent(error === "access_denied" ? "You declined access, so nothing was connected." : `Google returned: ${error}`)}`);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return back(`error=${encodeURIComponent("The response from Google was incomplete. Please try again.")}`);
  try {
    const { missing } = await handleCallback(user.id, code, state);
    return back(missing.length ? "connected=partial" : "connected=1");
  } catch (e) {
    return back(`error=${encodeURIComponent((e as Error).message)}`);
  }
}
