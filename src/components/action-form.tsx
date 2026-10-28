"use client";
import { useActionState, useEffect, useRef, type ReactNode } from "react";
import type { FormState } from "@/app/actions/auth";
import { FormMessage } from "./client";

/**
 * A form wired to a server action that returns { error } or { ok }.
 * Shows the message under the form and optionally resets the fields on success.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
  onSuccess,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  onSuccess?: () => void;
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) {
      if (resetOnSuccess) ref.current?.reset();
      onSuccess?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return (
    <form ref={ref} action={formAction} className={className ?? "flex flex-col gap-3"}>
      {children}
      <FormMessage state={state} />
    </form>
  );
}
