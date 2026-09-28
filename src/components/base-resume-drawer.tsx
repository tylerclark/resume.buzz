"use client";

import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { EMPTY_RESUME, type Entry, type Resume } from "@/lib/types";

const card = "bg-white border border-line-2 rounded-[14px] px-5 py-[18px] flex flex-col gap-2.5";
const field =
  "w-full box-border border border-line rounded-[10px] px-3.5 py-3 text-[13.5px] leading-[1.6] resize-none overflow-hidden text-ink bg-field";
const small = "w-full box-border border border-line rounded-lg px-2.5 py-1.5 text-[12.5px] text-ink bg-field min-w-0";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 min-w-0">
      <span className="text-[10.5px] font-bold tracking-[.06em] uppercase text-faint">{label}</span>
      {children}
    </label>
  );
}

// Grows to fit its content so long entries never need an inner scrollbar.
function AutoTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight + 2}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [props.value]);
  return <textarea ref={ref} rows={2} {...props} />;
}
const ghost =
  "bg-white border border-line-2 text-ink px-3.5 py-2 rounded-[9px] text-[13px] font-semibold cursor-pointer hover:bg-canvas disabled:opacity-60";

export function BaseResumeDrawer({ initial, onClose }: { initial: Resume | null; onClose: () => void }) {
  const router = useRouter();
  const isNew = !initial;
  const [r, setR] = useState<Resume>(() => initial ?? structuredClone(EMPTY_RESUME));
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "importing">("idle");
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const update = (fn: (draft: Resume) => void) => {
    setR((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
    setDirty(true);
    setStatus("idle");
  };

  const close = () => {
    if (dirty && !confirm("Discard unsaved changes to your base resume?")) return;
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (dirty && !confirm("Discard unsaved changes to your base resume?")) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, onClose]);

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
    setDirty(false);
    setStatus("saved");
    router.refresh();
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
    setDirty(true);
    setStatus("idle");
  }

  const newEntry = (): Entry => ({ role: "", org: "", dates: "", bullets: [] });

  return (
    <>
      <div onClick={close} className="fixed inset-0 z-20 bg-[rgba(15,27,61,.35)]" />
      <div
        role="dialog"
        aria-label="Base resume"
        className="fixed top-0 right-0 bottom-0 z-20 w-[1080px] max-w-[96vw] bg-canvas shadow-[-12px_0_40px_rgba(15,27,61,.18)] flex flex-col"
      >
        <header className="flex items-center gap-4 px-6 py-3.5 bg-white border-b border-line flex-none">
          <div>
            <div className="font-extrabold text-[15px]">Base resume</div>
            <div className="text-[12px] text-subtle">Source of truth for every tailored version</div>
          </div>
          {dirty && <span className="ml-auto text-[12px] text-faint">Unsaved changes</span>}
          <button
            onClick={save}
            disabled={status === "saving" || status === "importing"}
            className={`${dirty ? "" : "ml-auto "}bg-ink hover:bg-ink-hover text-white border-0 rounded-[9px] px-3.5 py-[9px] text-[13px] font-bold cursor-pointer disabled:opacity-60`}
          >
            {status === "saving" ? "Saving…" : status === "saved" ? "Saved ✓" : "Save"}
          </button>
          <button
            onClick={close}
            aria-label="Close"
            className="bg-transparent border-0 text-[20px] leading-none cursor-pointer text-subtle px-1"
          >
            ×
          </button>
        </header>

        <main className="flex-1 overflow-y-auto w-full box-border px-8 pt-6 pb-20 flex flex-col gap-5">
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
            <Field label="Name">
              <input
                value={r.name}
                onChange={(e) => update((d) => void (d.name = e.target.value))}
                placeholder="Full name"
                className={`${small} text-[15px] font-bold`}
              />
            </Field>
            <Field label="Headline">
              <input
                value={r.headline}
                onChange={(e) => update((d) => void (d.headline = e.target.value))}
                placeholder="e.g. Product designer · 8 years building software people rely on"
                className={small}
              />
            </Field>
            <Field label="Contact line">
              <input
                value={r.contact}
                onChange={(e) => update((d) => void (d.contact = e.target.value))}
                placeholder="City · email · website"
                className={small}
              />
            </Field>
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
                <div
                  key={ei}
                  className="flex flex-col gap-2 border-t border-line pt-3 first-of-type:border-0 first-of-type:pt-0"
                >
                  <div className="grid grid-cols-[1fr_1fr_220px_auto] gap-2 items-end">
                    <Field label="Role / degree">
                      <input
                        value={e.role}
                        onChange={(ev) => update((d) => void (d.sections[si].entries[ei].role = ev.target.value))}
                        placeholder="Optional"
                        className={small}
                      />
                    </Field>
                    <Field label="Company / school">
                      <input
                        value={e.org}
                        onChange={(ev) => update((d) => void (d.sections[si].entries[ei].org = ev.target.value))}
                        placeholder="Optional"
                        className={small}
                      />
                    </Field>
                    <Field label="Dates">
                      <input
                        value={e.dates}
                        onChange={(ev) => update((d) => void (d.sections[si].entries[ei].dates = ev.target.value))}
                        placeholder="2021 – present"
                        className={small}
                      />
                    </Field>
                    <button
                      onClick={() => update((d) => void d.sections[si].entries.splice(ei, 1))}
                      className="bg-transparent border-0 text-faint text-[16px] cursor-pointer hover:text-bad pb-1.5"
                      title="Remove entry"
                    >
                      ×
                    </button>
                  </div>
                  <Field label={e.role || e.org ? "Bullets — one per line" : "Lines — one per line"}>
                    <AutoTextarea
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
                      placeholder="One bullet per line"
                      className={field}
                    />
                  </Field>
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
            onClick={() =>
              update(
                (d) =>
                  void d.sections.push({
                    title: "New section",
                    entries: [newEntry()],
                  }),
              )
            }
            className={`${ghost} self-start`}
          >
            + Add section
          </button>
        </main>
      </div>
    </>
  );
}
