"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";

// Open tabs are a per-browser, per-user list of job ids (plus at most one "new job" tab), kept in
// localStorage so they survive reloads and stay in sync across browser windows via the storage event.
// The URL (/ or /j/[id]) says which tab is active; the store only knows which tabs are open.

export const NEW_TAB = "new";

export type TabsState = { ids: string[]; draftUrl: string };

const EMPTY: TabsState = { ids: [], draftUrl: "" };
const listeners = new Set<() => void>();
// Closing the active tab happens a beat before the route changes; remember what was just closed so the
// route → tab sync doesn't put it straight back.
const recentlyClosed = new Map<string, number>();
const RECENTLY_CLOSED_MS = 5000;
const cache = new Map<string, { raw: string | null; state: TabsState }>();

function keyFor(userId: string) {
  return `resume.buzz:tabs:${userId}`;
}

function read(key: string): TabsState {
  const raw = localStorage.getItem(key);
  const hit = cache.get(key);
  if (hit && hit.raw === raw) return hit.state;
  let state = EMPTY;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<TabsState>;
      state = {
        ids: Array.isArray(parsed.ids) ? [...new Set(parsed.ids.filter((x) => typeof x === "string"))] : [],
        draftUrl: typeof parsed.draftUrl === "string" ? parsed.draftUrl : "",
      };
    } catch {
      state = EMPTY;
    }
  }
  cache.set(key, { raw, state });
  return state;
}

function write(key: string, next: TabsState) {
  localStorage.setItem(key, JSON.stringify(next));
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key.startsWith("resume.buzz:tabs:")) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

const TabsContext = createContext<string | null>(null);

export function TabsProvider({ userId, children }: { userId: string; children: React.ReactNode }) {
  return <TabsContext.Provider value={keyFor(userId)}>{children}</TabsContext.Provider>;
}

export function useTabs() {
  const key = useContext(TabsContext);
  if (!key) throw new Error("useTabs must be used inside <TabsProvider>");
  const state = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => EMPTY,
  );

  const update = useCallback((fn: (s: TabsState) => TabsState) => write(key, fn(read(key))), [key]);

  const actions = useMemo(
    () => ({
      // Add a tab at the end if it isn't open already.
      open: (id: string) => {
        recentlyClosed.delete(id);
        update((s) => (s.ids.includes(id) ? s : { ...s, ids: [...s.ids, id] }));
      },
      // Same, but skipped for a tab that was closed a moment ago (used by the route → tab sync).
      ensure: (id: string) => {
        const closedAt = recentlyClosed.get(id);
        if (closedAt && Date.now() - closedAt < RECENTLY_CLOSED_MS) return;
        update((s) => (s.ids.includes(id) ? s : { ...s, ids: [...s.ids, id] }));
      },
      // Swap one tab for another in place (the "new job" tab becomes the job it started).
      replace: (from: string, to: string) =>
        update((s) => {
          recentlyClosed.set(from, Date.now());
          const ids = s.ids.filter((x) => x !== to);
          const i = ids.indexOf(from);
          if (i === -1) return { ...s, ids: [...ids, to] };
          ids[i] = to;
          return { ...s, ids, draftUrl: from === NEW_TAB ? "" : s.draftUrl };
        }),
      close: (id: string) => {
        recentlyClosed.set(id, Date.now());
        update((s) => ({ ...s, ids: s.ids.filter((x) => x !== id), draftUrl: id === NEW_TAB ? "" : s.draftUrl }));
      },
      // What's typed into the "new job" URL box, so switching tabs doesn't lose it.
      setDraftUrl: (draftUrl: string) => update((s) => (s.draftUrl === draftUrl ? s : { ...s, draftUrl })),
    }),
    [update],
  );

  return { ...state, ...actions };
}

// Which tab a pathname corresponds to.
export function tabIdForPath(pathname: string): string | null {
  if (pathname === "/") return NEW_TAB;
  const m = pathname.match(/^\/j\/([^/]+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}

export const hrefForTab = (id: string) => (id === NEW_TAB ? "/" : `/j/${id}`);

// Unsaved-edit guard. A workspace with a draft registers here; the tab bar asks before switching away,
// and the browser asks before unloading.
let leaveMessage: string | null = null;

export function useLeaveGuard(active: boolean, message = "You have unsaved edits. Leave anyway?") {
  useEffect(() => {
    if (!active) return;
    leaveMessage = message;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onUnload);
    return () => {
      leaveMessage = null;
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [active, message]);
}

export function confirmLeave() {
  return leaveMessage === null || window.confirm(leaveMessage);
}
