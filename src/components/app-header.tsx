"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { ApiTokensDialog } from "./api-tokens-dialog";
import { THEMES, useTheme, type Theme } from "./theme";
import { JOB_STAGES, stageInFlight } from "@/lib/types";
import { isBusy, shownScore, useJobStatuses, type JobStatus } from "./job-status";
import { Logo } from "./logo";
import { confirmLeave, hrefForTab, HOME_TAB, tabIdForPath, useTabs } from "./tabs-store";

function initials(s: string) {
  const parts = s
    .replace(/@.*/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function AppHeader({ user }: { user: { name: string; email: string } }) {
  return (
    <header className="flex items-center gap-3 pl-5 pr-5 bg-surface border-b border-line flex-none h-[64px] min-w-0">
      <Link href="/" className="hover:no-underline flex-none">
        <Logo height={26} priority />
      </Link>
      <TabBar />
      <div className="ml-auto flex-none">
        <UserMenu user={user} />
      </div>
    </header>
  );
}

function TabBar() {
  const pathname = usePathname();
  const router = useRouter();
  const tabs = useTabs();
  const active = tabIdForPath(pathname);
  const jobIds = tabs.ids;
  const statuses = useJobStatuses(jobIds);
  const stripRef = useRef<HTMLDivElement>(null);

  // Whatever route we're on is a tab, even if it was opened via a link, the history menu, or a bookmark.
  // Only on arrival: once it's closed (here, or in another window showing it) it stays closed.
  const synced = useRef<string | null>(null);
  useEffect(() => {
    if (!active || synced.current === active) return;
    synced.current = active;
    if (!tabs.ids.includes(active)) tabs.ensure(active);
  }, [active, tabs]);

  // Drop tabs whose job no longer exists (deleted elsewhere, or a stale id). If it's the active one, go home.
  useEffect(() => {
    for (const id of jobIds) {
      if (statuses[id]?.missing) {
        tabs.close(id);
        if (id === active) router.replace("/");
      }
    }
  }, [statuses, jobIds, tabs, active, router]);

  // Keep the active tab in view when there are more tabs than fit.
  useEffect(() => {
    const el = stripRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    el?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [active, tabs.ids.length]);

  function close(id: string) {
    if (id === active && !confirmLeave()) return;
    const i = tabs.ids.indexOf(id);
    tabs.close(id);
    if (id !== active) return;
    const rest = tabs.ids.filter((x) => x !== id);
    const next = rest[i] ?? rest[i - 1];
    router.push(next ? hrefForTab(next) : "/");
  }

  // Same as the workspace's discard: removing a job that's still working also cancels it.
  async function deleteJob(id: string) {
    const msg = isBusy(statuses[id]) ? "Stop tailoring this job and remove it?" : "Remove this job?";
    if (!confirm(msg)) return;
    const res = await fetch(`/api/jobs/${id}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) {
      alert("Couldn't remove it. Try again.");
      return;
    }
    tabs.close(id);
    if (id === active) router.replace("/");
    router.refresh();
  }

  return (
    <div role="tablist" aria-label="Open jobs" className="flex items-center gap-1 flex-1 min-w-0 h-full py-2">
      <HomeTab active={active === HOME_TAB} />
      <div
        ref={stripRef}
        className="flex items-center gap-1 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden h-full"
      >
        {tabs.ids.map((id) => (
          <TabChip
            key={id}
            id={id}
            status={statuses[id]}
            active={id === active}
            onClose={() => close(id)}
            onDelete={() => deleteJob(id)}
          />
        ))}
      </div>
    </div>
  );
}

// Always first, never closes. Where new jobs start.
function HomeTab({ active }: { active: boolean }) {
  return (
    <Link
      role="tab"
      aria-selected={active}
      aria-current={active ? "page" : undefined}
      href="/"
      title="Home"
      onClick={(e) => {
        if (!active && !confirmLeave()) e.preventDefault();
      }}
      className={`flex items-center gap-2 h-9 px-3 rounded-[9px] border flex-none text-inherit hover:no-underline transition-colors ${
        active
          ? "bg-canvas border-line-2 text-ink hover:text-ink"
          : "bg-surface border-transparent text-subtle hover:bg-canvas hover:text-ink"
      }`}
    >
      <HomeIcon className="w-4 h-4" />
      <span className="text-[12.5px] font-semibold">Home</span>
    </Link>
  );
}

function TabChip({
  id,
  status,
  active,
  onClose,
  onDelete,
}: {
  id: string;
  status: JobStatus | undefined;
  active: boolean;
  onClose: () => void;
  onDelete: () => void;
}) {
  // The tab strip scrolls horizontally, which clips anything absolutely positioned inside it, so the
  // menu is fixed to the viewport at the button's position.
  const [menuAt, setMenuAt] = useState<{ top: number; right: number } | null>(null);
  const menuOpen = menuAt !== null;
  const closeMenu = () => setMenuAt(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuAt(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);
  const busy = isBusy(status);
  const failed = status?.stage === "failed";
  const label = status ? status.title || hostOf(status.url) || (busy ? "Loading…" : "Pasted posting") : "Loading…";
  const detail = !status
    ? ""
    : stageInFlight(status.stage)
        ? JOB_STAGES[status.stage].label + "…"
        : status.coverStage === "writing"
          ? "Writing cover letter…"
          : failed
            ? status.error || "Failed"
            : status.company;

  return (
    <div
      role="tab"
      aria-selected={active}
      className={`relative flex items-center gap-2 h-9 pl-2.5 pr-1.5 rounded-[9px] border max-w-[340px] min-w-[200px] flex-none transition-colors ${
        active
          ? "bg-canvas border-line-2 text-ink"
          : "bg-surface border-transparent text-subtle hover:bg-canvas hover:text-ink"
      }`}
    >
      <Link
        href={hrefForTab(id)}
        aria-current={active ? "page" : undefined}
        title={detail ? `${label} — ${detail}` : label}
        onClick={(e) => {
          if (!active && !confirmLeave()) e.preventDefault();
        }}
        onAuxClick={(e) => {
          if (e.button === 1) {
            e.preventDefault();
            onClose();
          }
        }}
        className="flex items-center gap-2 min-w-0 flex-1 text-inherit hover:no-underline hover:text-inherit"
      >
        <TabIcon busy={busy} failed={failed} status={status} />
        <span className="min-w-0 flex flex-col leading-tight">
          <span className="text-[12.5px] font-semibold truncate">{label}</span>
          {detail && (
            <span className={`text-[10.5px] truncate ${failed ? "text-bad" : busy ? "text-brand" : "text-faint"}`}>
              {detail}
            </span>
          )}
        </span>
      </Link>
      {status && !busy && !failed && (
        <span className="flex-none text-[10.5px] font-bold text-ok-ink bg-ok-bg px-1.5 py-px rounded-full leading-4">
          {shownScore(status)}%
        </span>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (menuAt) return setMenuAt(null);
          const r = e.currentTarget.getBoundingClientRect();
          setMenuAt({ top: r.bottom + 6, right: window.innerWidth - r.right });
        }}
        title="Tab options"
        aria-label={`Options for ${label}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className="flex-none w-5 h-5 grid place-items-center rounded-md border-0 bg-transparent text-faint cursor-pointer hover:bg-line-2 hover:text-ink"
      >
        <DotsIcon className="w-3.5 h-3.5" />
      </button>
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => closeMenu()} />
          <div
            role="menu"
            style={{ top: menuAt.top, right: menuAt.right }}
            className="fixed z-20 bg-surface border border-line-2 rounded-[10px] shadow-menu p-1.5 min-w-[180px]"
          >
            <button
              role="menuitem"
              onClick={() => {
                closeMenu();
                onClose();
              }}
              className="w-full text-left bg-transparent hover:bg-canvas border-0 rounded-md px-2.5 py-2 text-[13px] font-semibold text-ink cursor-pointer"
            >
              Close tab
              {busy && <span className="block text-[11px] font-normal text-faint">Keeps working in the background</span>}
            </button>
            <button
              role="menuitem"
              onClick={() => {
                closeMenu();
                onDelete();
              }}
              className="w-full text-left bg-transparent hover:bg-bad-bg border-0 rounded-md px-2.5 py-2 text-[13px] font-semibold text-bad cursor-pointer"
            >
              {busy ? "Stop and delete job" : "Delete job"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function TabIcon({ busy, failed, status }: { busy: boolean; failed: boolean; status: JobStatus | undefined }) {
  if (busy) return <Spinner />;
  if (failed)
    return (
      <span className="flex-none w-[18px] h-[18px] rounded-[5px] bg-bad-bg text-bad grid place-items-center text-[11px] leading-none font-extrabold">
        !
      </span>
    );
  return (
    <span className="flex-none w-[18px] h-[18px] rounded-[5px] bg-ink text-on-ink grid place-items-center text-[10.5px] leading-none font-extrabold">
      {(status?.company || status?.title || "?")[0]?.toUpperCase()}
    </span>
  );
}

function HomeIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`block ${className}`}
    >
      <path d="M2.5 7.5 8 3l5.5 4.5V13a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5z" />
      <path d="M6.5 13.5V9.5h3v4" />
    </svg>
  );
}

function DotsIcon({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" fill="currentColor" className={`block ${className}`}>
      <circle cx="3" cy="8" r="1.5" />
      <circle cx="8" cy="8" r="1.5" />
      <circle cx="13" cy="8" r="1.5" />
    </svg>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`flex-none w-[18px] h-[18px] rounded-full border-2 border-brand border-t-transparent animate-spin ${className}`}
    />
  );
}

function UserMenu({ user }: { user: { name: string; email: string } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tokensOpen, setTokensOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        title={user.email}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="w-8 h-8 rounded-full bg-brand text-white grid place-items-center text-[12px] font-bold border-0 cursor-pointer"
      >
        {initials(user.name || user.email)}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            role="menu"
            className="absolute right-0 top-10 z-20 bg-surface border border-line-2 rounded-[10px] shadow-menu p-1.5 min-w-[220px]"
          >
            <div className="px-2.5 py-2 text-[12px] text-subtle truncate">{user.email}</div>
            <ThemePicker />
            <div className="my-1 border-t border-line" />
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setTokensOpen(true);
              }}
              className="w-full text-left bg-transparent hover:bg-canvas border-0 rounded-md px-2.5 py-2 text-[13px] font-semibold text-ink cursor-pointer"
            >
              API tokens
            </button>
            <button
              role="menuitem"
              onClick={async () => {
                await authClient.signOut();
                router.replace("/login");
                router.refresh();
              }}
              className="w-full text-left bg-transparent hover:bg-canvas border-0 rounded-md px-2.5 py-2 text-[13px] font-semibold text-ink cursor-pointer"
            >
              Sign out
            </button>
          </div>
        </>
      )}
      {tokensOpen && <ApiTokensDialog onClose={() => setTokensOpen(false)} />}
    </div>
  );
}

const THEME_LABELS: Record<Theme, string> = { light: "Light", dark: "Dark", system: "System" };

function ThemePicker() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="px-2.5 pt-1 pb-2">
      <div className="text-[11px] font-bold text-faint uppercase tracking-[.06em] mb-1.5">Theme</div>
      <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-0.5 p-0.5 bg-well rounded-lg">
        {THEMES.map((t) => {
          const on = t === theme;
          return (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setTheme(t)}
              title={t === "system" ? "Follow your OS setting" : THEME_LABELS[t]}
              className={`flex flex-col items-center gap-1 py-1.5 rounded-md border-0 cursor-pointer text-[11px] font-semibold transition-colors ${
                on ? "bg-surface text-ink shadow-pill" : "bg-transparent text-subtle hover:text-ink"
              }`}
            >
              <ThemeIcon theme={t} className="w-4 h-4" />
              {THEME_LABELS[t]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ThemeIcon({ theme, className = "" }: { theme: Theme; className?: string }) {
  const common = {
    "aria-hidden": true,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: `block ${className}`,
  };
  if (theme === "light")
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
    );
  if (theme === "dark")
    return (
      <svg {...common}>
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
    );
  return (
    <svg {...common}>
      <rect x="2" y="4" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 18v3" />
    </svg>
  );
}
