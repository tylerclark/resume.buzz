"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

type Options = {
  message: string;
  // `cancelLabel: null` drops the cancel button, for a one-button notice.
  confirmLabel?: string;
  cancelLabel?: string | null;
  danger?: boolean;
};

type Pending = Options & { resolve: (ok: boolean) => void };

let pending: Pending | null = null;
const listeners = new Set<() => void>();

function set(next: Pending | null) {
  pending = next;
  listeners.forEach((l) => l());
}

// In-app replacement for window.confirm(): resolves true when the user confirms. Needs <ConfirmHost />
// mounted once (root layout). Asking again while one is open cancels the earlier one.
export function confirmDialog(options: Options | string): Promise<boolean> {
  const opts = typeof options === "string" ? { message: options } : options;
  pending?.resolve(false);
  return new Promise((resolve) => set({ ...opts, resolve }));
}

// In-app replacement for window.alert().
export function alertDialog(message: string): Promise<boolean> {
  return confirmDialog({ message, confirmLabel: "OK", cancelLabel: null });
}

const btnGhost =
  "bg-surface hover:bg-canvas border border-line-2 text-ink px-3.5 py-2 rounded-[9px] text-[13px] font-semibold cursor-pointer whitespace-nowrap";
const btnPrimary =
  "bg-brand hover:bg-brand-hover text-white border-0 rounded-[9px] px-3.5 py-2 text-[13px] font-bold cursor-pointer whitespace-nowrap";
const btnDanger =
  "bg-bad hover:bg-bad-ink-2 text-white border-0 rounded-[9px] px-3.5 py-2 text-[13px] font-bold cursor-pointer whitespace-nowrap";

export function ConfirmHost() {
  const current = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => pending,
    () => null,
  );
  const confirmBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!current) return;
    const restore = document.activeElement as HTMLElement | null;
    confirmBtn.current?.focus();
    // Capture phase, so Escape answers this dialog instead of closing the drawer or dialog under it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      settle(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      restore?.focus?.();
    };
  }, [current]);

  if (!current) return null;

  function settle(ok: boolean) {
    const p = pending;
    if (!p) return;
    set(null);
    p.resolve(ok);
  }

  const { message, confirmLabel = "OK", cancelLabel = "Cancel", danger } = current;

  return (
    <>
      <div onClick={() => settle(false)} className="fixed inset-0 z-50 bg-scrim-strong" />
      <div
        role="alertdialog"
        aria-modal
        aria-label={message}
        className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] max-w-[92vw] bg-surface rounded-[16px] shadow-modal px-6 pt-5 pb-4 flex flex-col gap-4"
      >
        <p className="m-0 text-[14px] leading-[1.5] font-semibold text-ink">{message}</p>
        <div className="flex justify-end gap-2">
          {cancelLabel !== null && (
            <button type="button" onClick={() => settle(false)} className={btnGhost}>
              {cancelLabel}
            </button>
          )}
          <button
            ref={confirmBtn}
            type="button"
            onClick={() => settle(true)}
            className={danger ? btnDanger : btnPrimary}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </>
  );
}
