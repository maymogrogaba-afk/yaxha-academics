import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { sql, withUser } from "./db";
import { hashPassword, randomToken, sha256, verifyPassword } from "./crypto";
import { isProduction } from "./env";

export const SESSION_COOKIE = "yx_session";
const SESSION_DAYS = 30;
const MAX_FAILED_LOGINS = 8; // per email, per 15 minutes

export type CurrentUser = { id: string; email: string; fullName: string };

async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

async function startSession(userId: string) {
  const token = randomToken(32);
  const h = await headers();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await sql`insert into sessions (id_hash, user_id, expires_at, user_agent)
            values (${sha256(token)}, ${userId}, ${expires}, ${h.get("user-agent")?.slice(0, 300) ?? null})`;
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    expires,
  });
}

export async function signUp(email: string, password: string, fullName: string) {
  const existing = await sql`select 1 from users where lower(email) = lower(${email})`;
  if (existing.length) return { error: "An account with this email already exists. Try signing in." };
  const hash = await hashPassword(password);
  const [user] = await sql`insert into users (email, password_hash) values (${email}, ${hash}) returning id`;
  await withUser(user.id, async (tx) => {
    await tx`insert into profiles (user_id, full_name) values (${user.id}, ${fullName})`;
    await tx`insert into user_preferences (user_id) values (${user.id})`;
  });
  await startSession(user.id);
  return { ok: true as const };
}

export async function signIn(email: string, password: string) {
  const ip = await clientIp();
  const [{ count }] = await sql`select count(*)::int as count from login_attempts
    where lower(email) = lower(${email}) and success = false and created_at > now() - interval '15 minutes'`;
  if (count >= MAX_FAILED_LOGINS) {
    return { error: "Too many failed attempts. Please wait 15 minutes and try again." };
  }
  const [user] = await sql`select id, password_hash from users where lower(email) = lower(${email})`;
  const ok = user ? await verifyPassword(password, user.password_hash) : false;
  await sql`insert into login_attempts (email, ip, success) values (${email}, ${ip}, ${ok})`;
  if (!ok) return { error: "Email or password is incorrect." };
  await startSession(user.id);
  return { ok: true as const };
}

export async function signOut() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await sql`delete from sessions where id_hash = ${sha256(token)}`;
  jar.delete(SESSION_COOKIE);
}

/** The signed-in user for this request, or null. Cached for the duration of one request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const [row] = await sql`
    select u.id, u.email, coalesce(p.full_name, '') as full_name
    from sessions s join users u on u.id = s.user_id
    left join profiles p on p.user_id = u.id
    where s.id_hash = ${sha256(token)} and s.expires_at > now()`;
  if (!row) return null;
  return { id: row.id, email: row.email, fullName: row.full_name };
});

/** Use at the top of every protected page and server action. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
