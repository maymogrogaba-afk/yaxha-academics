"use client";
import { useEffect, useRef, useState } from "react";
import { ImagePlus, LoaderCircle, Send, X } from "lucide-react";
import { sendTutorMessage } from "@/app/actions/tutor";
import { Markdown } from "./markdown";
import { Button, Textarea, cx } from "./ui";

type Msg = { id: string; role: "user" | "assistant"; content: string; imageId: string | null };

const QUICK: Record<string, string[]> = {
  teach: ["Explain it more simply", "Show another worked example", "Give me a check question"],
  solve: ["Give me a hint for the next step", "Show the full solution", "Check my answer and units", "Give me a similar practice problem"],
  test: ["Next question", "I'm done — summarize my results"],
  fix: ["Give me practice on this weakness", "Explain the correct method again"],
};

export function TutorChat({
  sessionId,
  subjectId,
  mode,
  initial,
  placeholder,
  aiReady,
}: {
  sessionId: string;
  subjectId: string;
  mode: string;
  initial: Msg[];
  placeholder: string;
  aiReady: boolean;
}) {
  const [messages, setMessages] = useState<Msg[]>(initial);
  const [text, setText] = useState("");
  const [image, setImage] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  async function send(content: string) {
    if (busy || (!content.trim() && !image)) return;
    setBusy(true);
    setError(null);
    const imageId = image?.id ?? null;
    const optimistic: Msg = { id: `tmp-${Date.now()}`, role: "user", content: content.trim() || "Here is the problem.", imageId };
    setMessages((m) => [...m, optimistic]);
    setText("");
    setImage(null);
    const res = await sendTutorMessage(sessionId, content, imageId);
    if ("error" in res && res.error) {
      setMessages((m) => m.filter((x) => x.id !== optimistic.id));
      setText(content);
      if (imageId) setImage({ id: imageId, name: "attached image" });
      setError(res.error);
    } else if ("reply" in res) {
      setMessages((m) => [...m, { id: `a-${Date.now()}`, role: "assistant", content: res.reply!, imageId: null }]);
    }
    setBusy(false);
  }

  async function attach(file: File) {
    setUploading(true);
    setError(null);
    const fd = new FormData();
    fd.set("subjectId", subjectId);
    fd.set("purpose", "tutor");
    fd.set("file", file);
    const res = await fetch("/api/materials/upload", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setError(data.error ?? "The image could not be uploaded.");
    else setImage({ id: data.id, name: file.name });
    setUploading(false);
    if (fileInput.current) fileInput.current.value = "";
  }

  return (
    <div className="flex min-h-[60vh] flex-col">
      <div className="flex-1 space-y-4 pb-4" aria-live="polite">
        {messages.length === 0 && <p className="py-10 text-center text-sm text-muted">{placeholder}</p>}
        {messages.map((m) => (
          <div key={m.id} className={cx("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={cx(
                "max-w-[92%] rounded-card px-4 py-3 sm:max-w-[80%]",
                m.role === "user" ? "bg-raised text-ivory" : "border border-line bg-graphite",
              )}
            >
              {m.imageId && (
                <a href={`/api/materials/${m.imageId}/file`} target="_blank" rel="noopener" className="mb-2 block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/materials/${m.imageId}/file`} alt="Attached problem" className="max-h-64 rounded" />
                </a>
              )}
              {m.role === "assistant" ? <Markdown>{m.content}</Markdown> : <p className="whitespace-pre-wrap text-sm">{m.content}</p>}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <LoaderCircle className="size-4 animate-spin" /> Thinking through it…
          </div>
        )}
        <div ref={end} />
      </div>

      <div className="sticky bottom-20 rounded-card border border-line bg-graphite p-3 lg:bottom-4">
        {messages.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {(QUICK[mode] ?? []).map((q) => (
              <button key={q} type="button" onClick={() => send(q)} disabled={busy || !aiReady} className="rounded-full border border-line px-2.5 py-1 text-xs text-muted hover:border-gold/50 hover:text-ivory disabled:opacity-50">
                {q}
              </button>
            ))}
          </div>
        )}
        {image && (
          <div className="mb-2 flex items-center gap-2 text-xs text-muted">
            Image attached: {image.name}
            <button type="button" onClick={() => setImage(null)} aria-label="Remove image" className="text-faint hover:text-ivory">
              <X className="size-3.5" />
            </button>
          </div>
        )}
        {error && <p role="alert" className="mb-2 text-sm text-bad">{error}</p>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(text);
          }}
          className="flex items-end gap-2"
        >
          <input ref={fileInput} type="file" accept=".png,.jpg,.jpeg,.webp" className="sr-only" id="tutor-image" onChange={(e) => e.target.files?.[0] && attach(e.target.files[0])} />
          <label htmlFor="tutor-image" className={cx("flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-line text-muted hover:text-ivory", (uploading || !aiReady) && "pointer-events-none opacity-50")} title="Attach a photo of a problem">
            {uploading ? <LoaderCircle className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
            <span className="sr-only">Attach image</span>
          </label>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(text);
              }
            }}
            rows={2}
            placeholder={aiReady ? placeholder : "AI is not configured on this server."}
            disabled={!aiReady}
            aria-label="Message"
            className="min-h-10 resize-none"
          />
          <Button type="submit" variant="primary" disabled={busy || !aiReady || (!text.trim() && !image)} aria-label="Send" className="size-10 shrink-0 px-0">
            <Send className="size-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}
