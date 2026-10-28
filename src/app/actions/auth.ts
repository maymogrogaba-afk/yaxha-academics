"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { signIn, signUp } from "@/lib/auth";
import { env } from "@/lib/env";

export type FormState = { error?: string; ok?: string } | null;

const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address.").max(200);

export async function signInAction(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = z
    .object({ email: emailSchema, password: z.string().min(1, "Enter your password.").max(200) })
    .safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const res = await signIn(parsed.data.email, parsed.data.password);
  if ("error" in res) return { error: res.error };
  redirect("/home");
}

export async function signUpAction(_prev: FormState, form: FormData): Promise<FormState> {
  if (!env.allowSignup) return { error: "New sign-ups are turned off for this installation." };
  const parsed = z
    .object({
      fullName: z.string().trim().min(1, "Enter your name.").max(120),
      email: emailSchema,
      password: z.string().min(10, "Use at least 10 characters for your password.").max(200),
    })
    .safeParse({ fullName: form.get("fullName"), email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const res = await signUp(parsed.data.email, parsed.data.password, parsed.data.fullName);
  if ("error" in res) return { error: res.error };
  redirect("/welcome");
}
