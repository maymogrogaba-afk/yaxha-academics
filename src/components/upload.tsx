"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Upload } from "lucide-react";
import { ACCEPT_ATTR } from "@/lib/files/types";
import { buttonClass } from "./ui";

/** Upload button: sends files one at a time and reports the real processing result. */
export function UploadButton({ subjectId, topicId, maxMb }: { subjectId: string; topicId?: string; maxMb: number }) {
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<{ name: string; text: string; ok: boolean }[]>([]);

  async function upload(files: FileList) {
    setBusy(true);
    const out: typeof messages = [];
    for (const file of Array.from(files)) {
      if (file.size > maxMb * 1024 * 1024) {
        out.push({ name: file.name, text: `Larger than the ${maxMb} MB limit.`, ok: false });
        continue;
      }
      const fd = new FormData();
      fd.set("subjectId", subjectId);
      if (topicId) fd.set("topicId", topicId);
      fd.set("file", file);
      try {
        const res = await fetch("/api/materials/upload", { method: "POST", body: fd });
        const data = await res.json().catch(() => ({ error: "Upload failed." }));
        if (!res.ok) out.push({ name: file.name, text: data.error ?? "Upload failed.", ok: false });
        else
          out.push({
            name: file.name,
            text: data.status === "ready" ? "Uploaded and text extracted." : `Uploaded. ${data.message ?? ""}`,
            ok: data.status === "ready",
          });
      } catch {
        out.push({ name: file.name, text: "Network error during upload.", ok: false });
      }
    }
    setMessages(out);
    setBusy(false);
    if (input.current) input.current.value = "";
    router.refresh();
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT_ATTR}
        className="sr-only"
        id={`upload-${subjectId}`}
        onChange={(e) => e.target.files?.length && upload(e.target.files)}
      />
      <label htmlFor={`upload-${subjectId}`} className={buttonClass("secondary", "sm", busy ? "pointer-events-none opacity-60" : "cursor-pointer")}>
        {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Upload className="size-4" />}
        {busy ? "Uploading…" : "Upload files"}
      </label>
      {messages.length > 0 && (
        <ul className="text-xs" aria-live="polite">
          {messages.map((m, i) => (
            <li key={i} className={m.ok ? "text-ok" : "text-warn"}>
              {m.name}: {m.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
