"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { requireUser, SESSION_COOKIE } from "@/lib/auth";
import { sql, withUser } from "@/lib/db";
import { hashPassword, sha256, verifyPassword } from "@/lib/crypto";
import { disconnectGoogle } from "@/lib/google/oauth";
import type { FormState } from "./auth";

export async function saveProfile(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = z
    .object({ fullName: z.string().trim().min(1).max(120), school: z.string().trim().max(160), program: z.string().trim().max(160), yearLevel: z.string().trim().max(40) })
    .safeParse({ fullName: form.get("fullName"), school: form.get("school") ?? "", program: form.get("program") ?? "", yearLevel: form.get("yearLevel") ?? "" });
  if (!parsed.success) return { error: "Enter your name." };
  const d = parsed.data;
  await withUser(user.id, (tx) => tx`
    insert into profiles (user_id, full_name, school, program, year_level) values (${user.id}, ${d.fullName}, ${d.school}, ${d.program}, ${d.yearLevel})
    on conflict (user_id) do update set full_name = excluded.full_name, school = excluded.school, program = excluded.program, year_level = excluded.year_level`);
  revalidatePath("/", "layout");
  return { ok: "Profile saved." };
}

const timeRe = /^\d{2}:\d{2}$/;

export async function savePreferences(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = z
    .object({
      timezone: z.string().refine((tz) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      }, "Unknown time zone."),
      dailyTarget: z.coerce.number().int().min(15).max(960),
      session: z.coerce.number().int().min(10).max(180),
      breakMin: z.coerce.number().int().min(0).max(60),
      days: z.array(z.coerce.number().int().min(0).max(6)).min(1, "Choose at least one study day."),
      start: z.string().regex(timeRe),
      end: z.string().regex(timeRe),
      reminders: z.boolean(),
      finishOnboarding: z.boolean(),
    })
    .safeParse({
      timezone: form.get("timezone") ?? "Asia/Manila",
      dailyTarget: form.get("dailyTarget"),
      session: form.get("session"),
      breakMin: form.get("breakMin") ?? 10,
      days: form.getAll("days"),
      start: form.get("start") ?? "19:00",
      end: form.get("end") ?? "22:00",
      reminders: form.get("reminders") === "on",
      finishOnboarding: form.get("finishOnboarding") === "1",
    });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  await withUser(user.id, async (tx) => {
    await tx`insert into user_preferences (user_id) values (${user.id}) on conflict (user_id) do nothing`;
    await tx`update user_preferences set timezone = ${d.timezone}, daily_target_minutes = ${d.dailyTarget}, session_minutes = ${d.session},
      break_minutes = ${d.breakMin}, available_days = ${d.days}::smallint[], preferred_start = ${d.start}, preferred_end = ${d.end},
      reminders_enabled = ${d.reminders}, onboarding_done = onboarding_done or ${d.finishOnboarding}`;
  });
  revalidatePath("/", "layout");
  if (d.finishOnboarding) redirect("/home");
  return { ok: "Preferences saved." };
}

export async function skipOnboarding() {
  const user = await requireUser();
  await withUser(user.id, (tx) => tx`update user_preferences set onboarding_done = true`);
  redirect("/home");
}

export async function changePassword(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const current = String(form.get("current") ?? "");
  const next = String(form.get("next") ?? "");
  if (next.length < 10) return { error: "Use at least 10 characters for the new password." };
  const [u] = await sql`select password_hash from users where id = ${user.id}`;
  if (!(await verifyPassword(current, u.password_hash))) return { error: "Your current password is incorrect." };
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  await sql`update users set password_hash = ${await hashPassword(next)} where id = ${user.id}`;
  // Sign out every other device.
  await sql`delete from sessions where user_id = ${user.id} and id_hash <> ${sha256(token)}`;
  return { ok: "Password changed. Other devices were signed out." };
}

export async function signOutOtherDevices() {
  const user = await requireUser();
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  await sql`delete from sessions where user_id = ${user.id} and id_hash <> ${sha256(token)}`;
  revalidatePath("/settings");
}

/** Permanently deletes the account and every record that belongs to it. */
export async function deleteAccount(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  if (form.get("confirm") !== "DELETE") return { error: 'Type DELETE in capital letters to confirm.' };
  const [u] = await sql`select password_hash from users where id = ${user.id}`;
  if (!(await verifyPassword(String(form.get("password") ?? ""), u.password_hash))) return { error: "Your password is incorrect." };
  await disconnectGoogle(user.id, false).catch(() => {});
  await sql`delete from users where id = ${user.id}`; // every table cascades from users
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/");
}
