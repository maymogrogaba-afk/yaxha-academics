"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { disconnectGoogle } from "@/lib/google/oauth";
import { syncClassroom } from "@/lib/google/sync";
import type { FormState } from "./auth";

export async function syncNow(): Promise<FormState> {
  const user = await requireUser();
  try {
    const s = await syncClassroom(user.id);
    revalidatePath("/", "layout");
    if (s.status === "failed") return { error: `Sync failed: ${s.issues.map((i) => i.message).join(" ")}` };
    const msg = `Found ${s.coursesFound} course${s.coursesFound === 1 ? "" : "s"} (${s.subjectsCreated} new), ${s.itemsImported} new item${s.itemsImported === 1 ? "" : "s"}, ${s.filesDownloaded} file${s.filesDownloaded === 1 ? "" : "s"} downloaded.`;
    return s.status === "partial" ? { ok: `${msg} Some items need attention — see below.` } : { ok: msg };
  } catch (e) {
    revalidatePath("/classroom");
    return { error: (e as Error).message };
  }
}

export async function disconnectAction(form: FormData) {
  const user = await requireUser();
  await disconnectGoogle(user.id, form.get("removeImported") === "on");
  revalidatePath("/", "layout");
}
