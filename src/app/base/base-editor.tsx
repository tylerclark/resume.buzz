"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Logo } from "@/components/logo";
import type { Entry, Resume } from "@/lib/types";

const card = "bg-white border border-line-2 rounded-[14px] px-5 py-[18px] flex flex-col gap-2.5";
const field =
  "w-full box-border border border-line rounded-[10px] px-3.5 py-3 text-[13.5px] leading-[1.6] resize-y text-ink bg-field";
const small = "border border-line rounded-lg px-2.5 py-1.5 text-[12.5px] text-ink bg-field min-w-0";
const ghost =
  "bg-white border border-line-2 text-ink px-3.5 py-2 rounded-[9px] text-[13px] font-semibold cursor-pointer hover:bg-canvas disabled:opacity-60";

export function BaseEditor({ initial, isNew }: { initial: Resume; isNew: boolean }) {
  const [r, setR] = useState(initial);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "importing">("idle");
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const update = (fn: (draft: Resume) => void) => {
    setR((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
    setStatus("idle");
  };

  async function save() {
    setStatus("saving");
    setError(null);
    const res = await fetch("/api/resume", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(r),
    });
    if (!res.ok) {
      setStatus("idle");
      return setError((await res.json().catch(() => ({}))).error ?? "Save failed.");
    }
    setStatus("saved");
  }

  async function importFile(file: File) {
    setStatus("importing");
    setError(null);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/resume/import", { method: "POST", body: fd });
    const body = await res.json();
    if (!res.ok) {
      setStatus("idle");
      return setError(body.error ?? "Import failed.");
    }
    setR(body);
    setStatus("idle");
  }

  const newEntry = (): Entry => ({ role: "", org: "", dates: "", bullets: [] });

  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center gap-4 px-7 py-3.5 bg-white border-b border-line sticky top-0 z-10">
        <Link href="/" className="text-subtle text-[13px] font-semibold py-1 hover:no-underline">
          ← Back
        </Link>
        <Logo height={20} />
        <span className="text-[14px] font-bold ml-2">Base resume</span>
        <span className="text-[12px] text-subtle ml-auto">Source of truth for every tailored version</span>
        <button
          onClick={save}
          disabled={status === "saving" || status === "importing"}
          className="bg-ink hover:bg-ink-hover text-white border-0 rounded-[9px] px-3.5 py-[9px] text-[13px] font-bold cursor-pointer disabled:opacity-60"
        >
          {status === "saving" ? "Saving…" : status === "saved" ? "Saved ✓" : "Save"}
        </button>
      </header>

      <main className="max-w-[860px] w-full box-border mx-auto px-8 pt-9 pb-20 flex flex-col gap-5">
        <div className="flex gap-2.5 items-center bg-white border border-dashed border-[#b9c6de] rounded-[14px] px-[18px] py-4">
          <div className="flex-1">
            <div className="font-bold text-[14px]">{isNew ? "Upload PDF or DOCX" : "Re-upload PDF or DOCX"}</div>
            <div className="text-[12.5px] text-subtle">
              {status === "importing"
                ? "Reading your resume…"
                : "We'll parse it into sections below. Your edits here are what gets tailored."}
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importFile(f);
              e.target.value = "";
            }}
          />
          <button onClick={() => fileRef.current?.click()} disabled={status === "importing"} className={ghost}>
            {status === "importing" ? "Parsing…" : "Choose file"}
          </button>
        </div>
        {error && <p className="m-0 text-[13px] text-bad">{error}</p>}

        <section className={card}>
          <div className="eyebrow text-ink">Header</div>
          <input
            value={r.name}
            onChange={(e) => update((d) => void (d.name = e.target.value))}
            placeholder="Full name"
            className={`${small} text-[15px] font-bold`}
          />
          <input
            value={r.headline}
            onChange={(e) => update((d) => void (d.headline = e.target.value))}
            placeholder="Headline — e.g. Product designer · 8 years building software people rely on"
            className={small}
          />
          <input
            value={r.contact}
            onChange={(e) => update((d) => void (d.contact = e.target.value))}
            placeholder="City · email · website"
            className={small}
          />
        </section>

        {r.sections.map((s, si) => (
          <section key={si} className={card}>
            <div className="flex justify-between items-center gap-3">
              <input
                value={s.title}
                onChange={(e) => update((d) => void (d.sections[si].title = e.target.value))}
                className="font-extrabold text-[12px] tracking-[.08em] uppercase border-0 py-1 text-ink bg-transparent outline-none flex-1"
              />
              <button
                onClick={() => update((d) => void d.sections.splice(si, 1))}
                className="bg-transparent border-0 text-faint text-[12px] font-semibold cursor-pointer hover:text-bad"
              >
                Remove section
              </button>
            </div>
            {s.entries.map((e, ei) => (
              <div key={ei} className="flex flex-col gap-2 border-t border-line pt-3 first-of-type:border-0 first-of-type:pt-0">
                <div className="grid grid-cols-[1fr_1fr_160px_auto] gap-2 items-center">
                  <input
                    value={e.role}
                    onChange={(ev) => update((d) => void (d.sections[si].entries[ei].role = ev.target.value))}
                    placeholder="Role / degree (optional)"
                    className={small}
                  />
                  <input
                    value={e.org}
                    onChange={(ev) => update((d) => void (d.sections[si].entries[ei].org = ev.target.value))}
                    placeholder="Company / school"
                    className={small}
                  />
                  <input
                    value={e.dates}
                    onChange={(ev) => update((d) => void (d.sections[si].entries[ei].dates = ev.target.value))}
                    placeholder="2021 – present"
                    className={small}
                  />
                  <button
                    onClick={() => update((d) => void d.sections[si].entries.splice(ei, 1))}
                    className="bg-transparent border-0 text-faint text-[16px] cursor-pointer hover:text-bad"
                    title="Remove entry"
                  >
                    ×
                  </button>
                </div>
                <textarea
                  value={e.bullets.join("\n")}
                  onChange={(ev) =>
                    update((d) => void (d.sections[si].entries[ei].bullets = ev.target.value.split("\n")))
                  }
                  onBlur={() =>
                    update(
                      (d) =>
                        void (d.sections[si].entries[ei].bullets = d.sections[si].entries[ei].bullets
                          .map((b) => b.replace(/^\s*[•\-*]\s*/, "").trimEnd())
                          .filter(Boolean)),
                    )
                  }
                  rows={Math.max(2, e.bullets.length + 1)}
                  placeholder="One bullet per line"
                  className={field}
                />
              </div>
            ))}
            <button
              onClick={() => update((d) => void d.sections[si].entries.push(newEntry()))}
              className="self-start bg-transparent border-0 text-brand text-[12.5px] font-semibold cursor-pointer p-0"
            >
              + Add entry
            </button>
          </section>
        ))}

        <button
          onClick={() => update((d) => void d.sections.push({ title: "New section", entries: [newEntry()] }))}
          className={`${ghost} self-start`}
        >
          + Add section
        </button>
      </main>
    </div>
  );
}
