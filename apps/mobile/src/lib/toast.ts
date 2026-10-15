import { useSyncExternalStore } from "react";

import { ApiError } from "@/lib/api/client";
import { errorText } from "@/lib/error-messages";

/**
 * A tiny global in-app banner ("toast"): one message at a time at the top of
 * the screen. Used for foreground alerts (ALR-05), console notices (ALR-07)
 * and action errors with their request ID (NFR-12).
 */

export type ToastTone = "info" | "success" | "warning" | "danger";

export type Toast = {
  id: number;
  title: string;
  message?: string;
  tone: ToastTone;
  /** Tapping the banner runs this (e.g. open the ticket). */
  onPress?: () => void;
  durationMs: number;
};

let current: Toast | null = null;
let nextId = 1;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function showToast(input: {
  title: string;
  message?: string;
  tone?: ToastTone;
  onPress?: () => void;
  durationMs?: number;
}) {
  if (timer) clearTimeout(timer);
  const toast: Toast = {
    id: nextId++,
    title: input.title,
    message: input.message,
    tone: input.tone ?? "info",
    onPress: input.onPress,
    durationMs: input.durationMs ?? 5000,
  };
  current = toast;
  emit();
  timer = setTimeout(() => hideToast(toast.id), toast.durationMs);
}

/** Error banner: friendly text, then code and request ID for support. */
export function showErrorToast(title: string, error: unknown) {
  const api = error instanceof ApiError ? error : null;
  const support = api
    ? `\nCode: ${api.code}${api.requestId ? ` · Request ID: ${api.requestId}` : ""}`
    : "";
  showToast({
    title,
    message: `${errorText(error)}${support}`,
    tone: "danger",
    durationMs: 8000,
  });
}

export function hideToast(id?: number) {
  if (!current || (id !== undefined && current.id !== id)) return;
  current = null;
  if (timer) clearTimeout(timer);
  timer = null;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useToast(): Toast | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => current,
  );
}
