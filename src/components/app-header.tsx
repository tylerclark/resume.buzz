"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { JOB_STAGES, stageInFlight } from "@/lib/types";
import { isBusy, useJobStatuses, type JobStatus } from "./job-status";
import { Logo } from "./logo";
import { confirmLeave, hrefForTab, NEW_TAB, tabIdForPath, useTabs } from "./tabs-store";

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
    <header className="flex items-center gap-3 pl-5 pr-5 bg-white border-b border-line flex-none h-[64px] min-w-0">
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
  const jobIds = tabs.ids.filter((id) => id !== NEW_TAB);
  const statuses = useJobStatuses(jobIds);
  const stripRef = useRef<HTMLDivElement>(null);

  // Whatever route we're on is a tab, even if it was opened via a link, the history menu, or a bookmark.
  useEffect(() => {
    if (active && !tabs.ids.includes(active)) tabs.ensure(active);
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

  function openNew() {
    if (active !== NEW_TAB && !confirmLeave()) return;
    if (!tabs.ids.includes(NEW_TAB)) tabs.open(NEW_TAB);
    router.push("/");
  }

  return (
    <div className="flex items-center gap-1 flex-1 min-w-0 h-full">
      <div
        ref={stripRef}
        role="tablist"
        aria-label="Open jobs"
        className="flex items-center gap-1 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden py-2 h-full"
      >
        {tabs.ids.map((id) => (
          <TabChip
            key={id}
            id={id}
            status={id === NEW_TAB ? undefined : statuses[id]}
            active={id === active}
            onClose={() => close(id)}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={openNew}
        title="New job"
        aria-label="New job"
        className="flex-none w-8 h-8 grid place-items-center rounded-lg border-0 bg-transparent text-subtle text-[20px] leading-none cursor-pointer hover:bg-canvas hover:text-ink"
      >
        +
      </button>
    </div>
  );
}

function TabChip({
  id,
  status,
  active,
  onClose,
}: {
  id: string;
  status: JobStatus | undefined;
  active: boolean;
  onClose: () => void;
}) {
  const isNew = id === NEW_TAB;
  const busy = isBusy(status);
  const failed = !isNew && status?.stage === "failed";
  const label = isNew ? "New job" : status ? status.title || hostOf(status.url) || "Loading…" : "Loading…";
  const detail = isNew
    ? ""
    : !status
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
      className={`group relative flex items-center gap-2 h-9 pl-2.5 pr-1.5 rounded-[9px] border max-w-[220px] min-w-[120px] flex-none transition-colors ${
        active
          ? "bg-canvas border-line-2 text-ink"
          : "bg-white border-transparent text-subtle hover:bg-canvas hover:text-ink"
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
        <TabIcon isNew={isNew} busy={busy} failed={failed} status={status} />
        <span className="min-w-0 flex flex-col leading-tight">
          <span className="text-[12.5px] font-semibold truncate">{label}</span>
          {detail && (
            <span className={`text-[10.5px] truncate ${failed ? "text-bad" : busy ? "text-brand" : "text-faint"}`}>
              {detail}
            </span>
          )}
        </span>
      </Link>
      {!isNew && status && !busy && !failed && (
        <span className="flex-none text-[10.5px] font-bold text-ok-ink bg-ok-bg px-1.5 py-px rounded-full group-hover:hidden">
          {status.score}%
        </span>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }}
        title={busy ? "Close tab (keeps working in the background)" : "Close tab"}
        aria-label={`Close ${label}`}
        className={`flex-none w-5 h-5 grid place-items-center rounded-md border-0 bg-transparent text-faint text-[15px] leading-none cursor-pointer hover:bg-line-2 hover:text-ink ${
          !isNew && status && !busy && !failed ? "hidden group-hover:grid" : ""
        }`}
      >
        ×
      </button>
    </div>
  );
}

function TabIcon({
  isNew,
  busy,
  failed,
  status,
}: {
  isNew: boolean;
  busy: boolean;
  failed: boolean;
  status: JobStatus | undefined;
}) {
  if (isNew)
    return (
      <span className="flex-none w-[18px] h-[18px] rounded-[5px] border border-dashed border-line-3 grid place-items-center text-[12px] text-faint">
        +
      </span>
    );
  if (busy) return <Spinner />;
  if (failed)
    return (
      <span className="flex-none w-[18px] h-[18px] rounded-[5px] bg-bad-bg text-bad grid place-items-center text-[11px] font-extrabold">
        !
      </span>
    );
  return (
    <span className="flex-none w-[18px] h-[18px] rounded-[5px] bg-ink text-white grid place-items-center text-[10.5px] font-extrabold">
      {(status?.company || status?.title || "?")[0]?.toUpperCase()}
    </span>
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
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        title={user.email}
        className="w-8 h-8 rounded-full bg-brand text-white grid place-items-center text-[12px] font-bold border-0 cursor-pointer"
      >
        {initials(user.name || user.email)}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-10 z-20 bg-white border border-line-2 rounded-[10px] shadow-[0_8px_24px_rgba(15,27,61,.12)] p-1.5 min-w-[200px]">
            <div className="px-2.5 py-2 text-[12px] text-subtle truncate">{user.email}</div>
            <button
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
    </div>
  );
}
