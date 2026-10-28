"use client";
// Small interactive pieces shared across pages.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { LoaderCircle, X } from "lucide-react";
import { buttonClass, cx } from "./ui";

/** A submit button that shows a spinner while its form is being processed. */
export function SubmitButton({
  children,
  pendingText,
  variant = "primary",
  size = "md",
  className,
  confirm,
  name,
  value,
  disabled,
}: {
  children: ReactNode;
  pendingText?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  className?: string;
  confirm?: string;
  name?: string;
  value?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending || disabled}
      aria-busy={pending}
      className={buttonClass(variant, size, className)}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {pending && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
      {pending && pendingText ? pendingText : children}
    </button>
  );
}

/** Accessible modal dialog built on the native <dialog> element. */
export function Dialog({
  trigger,
  title,
  children,
  triggerClassName,
  wide,
}: {
  trigger: ReactNode;
  title: string;
  children: ReactNode | ((close: () => void) => ReactNode);
  triggerClassName?: string;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = () => ref.current?.close();
  return (
    <>
      <button type="button" className={triggerClassName ?? buttonClass("secondary", "sm")} onClick={() => ref.current?.showModal()}>
        {trigger}
      </button>
      <dialog
        ref={ref}
        aria-label={title}
        className={cx(
          "m-auto w-[calc(100%-2rem)] rounded-card border border-line bg-graphite p-0 text-ivory backdrop:bg-black/70",
          wide ? "max-w-2xl" : "max-w-md",
        )}
        onClick={(e) => {
          if (e.target === ref.current) close();
        }}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button type="button" onClick={close} className="rounded-md p-1 text-muted hover:text-ivory" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto px-5 py-4">
          {/* eslint-disable-next-line react-hooks/refs -- `close` only reads the ref when called from an event handler */}
          {typeof children === "function" ? children(close) : children}
        </div>
      </dialog>
    </>
  );
}

/** Shows a short message that fades away; used for "Saved" style feedback. */
export function Flash({ message, tone = "ok" }: { message?: string | null; tone?: "ok" | "bad" }) {
  const [dismissed, setDismissed] = useState<string | null>(null);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setDismissed(message), 5000);
    return () => clearTimeout(t);
  }, [message]);
  if (!message || dismissed === message) return null;
  return (
    <div
      role="status"
      className={cx(
        "fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-lg border px-4 py-2 text-sm shadow-lg lg:bottom-6",
        tone === "ok" ? "border-ok/40 bg-graphite text-ivory" : "border-bad/40 bg-graphite text-bad",
      )}
    >
      {message}
    </div>
  );
}

/** Renders an inline form error/success message returned by a server action. */
export function FormMessage({ state }: { state?: { error?: string; ok?: string } | null }) {
  if (!state) return null;
  if (state.error)
    return (
      <p role="alert" className="text-sm text-bad">
        {state.error}
      </p>
    );
  if (state.ok)
    return (
      <p role="status" className="text-sm text-ok">
        {state.ok}
      </p>
    );
  return null;
}
