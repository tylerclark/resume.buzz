"use client";

import { createContext, useCallback, useContext, useEffect, useSyncExternalStore } from "react";

export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];
type Resolved = "light" | "dark";

const STORAGE_KEY = "theme";
const MQ = "(prefers-color-scheme: dark)";

function isTheme(v: unknown): v is Theme {
  return typeof v === "string" && (THEMES as readonly string[]).includes(v);
}

function readStored(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isTheme(v) ? v : "system";
  } catch {
    return "system";
  }
}

function resolve(theme: Theme): Resolved {
  return theme === "system" ? (window.matchMedia(MQ).matches ? "dark" : "light") : theme;
}

function apply(resolved: Resolved) {
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

// The preference lives in localStorage (and the OS, for "system"); React just mirrors it.
const listeners = new Set<() => void>();
function emit() {
  for (const l of listeners) l();
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  const mq = window.matchMedia(MQ);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === STORAGE_KEY) cb();
  };
  mq.addEventListener("change", cb);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    mq.removeEventListener("change", cb);
    window.removeEventListener("storage", onStorage);
  };
}
const serverSnapshot = () => "system" as const;

const ThemeContext = createContext<{ theme: Theme; resolved: Resolved; setTheme: (t: Theme) => void } | null>(
  null,
);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Server (and first client render) sees "system"; ThemeScript already set the class before paint,
  // so the only thing that snaps on hydration is the picker's checked state.
  const theme = useSyncExternalStore(subscribe, readStored, serverSnapshot);
  const resolved = useSyncExternalStore(subscribe, () => resolve(readStored()), () => "light" as const);

  // Re-apply whenever the resolved value changes from outside (OS toggle, another tab).
  useEffect(() => {
    apply(resolved);
  }, [resolved]);

  const setTheme = useCallback((t: Theme) => {
    try {
      if (t === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, t);
    } catch {}
    apply(resolve(t));
    emit();
  }, []);

  return <ThemeContext.Provider value={{ theme, resolved, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}

// Inline in <head> so the first paint already has the right class: no light flash on reload in dark mode.
const SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(STORAGE_KEY)});var d=t==="dark"||(t!=="light"&&matchMedia(${JSON.stringify(MQ)}).matches);if(d)document.documentElement.classList.add("dark")}catch(e){}})()`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
