"use client";

import { finalText, type StoredLine, type StoredTailored } from "@/lib/types";
import { AutoTextarea } from "./auto-textarea";

const lineCls =
  "w-full box-border border border-transparent hover:border-line focus:border-line rounded-md px-2 py-1 -mx-2 text-[13.5px] leading-[1.55] resize-none overflow-hidden bg-transparent focus:bg-field font-serif text-ink-2";
const tool =
  "bg-transparent border-0 p-0 text-[11.5px] font-semibold font-sans cursor-pointer whitespace-nowrap text-faint hover:text-ink";

// Setting a line's text; typing it back to the AI version drops the override.
function withText(line: StoredLine, v: string): StoredLine {
  const next: StoredLine = { ...line, edited: v };
  if (v === line.text) delete next.edited;
  return next;
}

function LineEditor({
  line,
  onChange,
  onRemove,
  paragraph,
}: {
  line: StoredLine;
  onChange: (l: StoredLine) => void;
  onRemove: () => void;
  paragraph?: boolean;
}) {
  const text = finalText(line);
  const edited = line.edited !== undefined && line.edited !== line.text;

  if (!text) {
    // Removed by the AI or by you — show it so it can come back.
    const restoreTo = line.text || line.original;
    return (
      <div className="flex gap-3 items-baseline py-1">
        <span className="flex-1 text-[13.5px] leading-[1.55] text-faint line-through">{line.original}</span>
        {restoreTo && (
          <button onClick={() => onChange(withText(line, restoreTo))} className={`${tool} text-brand`}>
            Restore
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`flex gap-2 items-start ${paragraph ? "" : "pl-1"}`}>
      {!paragraph && <span className="pt-[5px] text-[13.5px] leading-[1.55] select-none">•</span>}
      <AutoTextarea
        value={text}
        onChange={(e) => onChange(withText(line, e.target.value.replace(/\n/g, " ")))}
        className={`${lineCls} ${edited ? "bg-user-del/60" : ""}`}
      />
      <div className="flex gap-2.5 pt-[7px]">
        {edited && (
          <button
            onClick={() => onChange(withText(line, line.text))}
            className={tool}
            title="Undo your edits to this line"
          >
            ↺ AI version
          </button>
        )}
        <button onClick={onRemove} className={`${tool} hover:text-bad`} title="Remove line">
          ×
        </button>
      </div>
    </div>
  );
}

export function TailoredEditor({
  value,
  onChange,
  name,
  contact,
}: {
  value: StoredTailored;
  onChange: (v: StoredTailored) => void;
  name: string;
  contact: string;
}) {
  const update = (fn: (d: StoredTailored) => void) => {
    const next = structuredClone(value);
    fn(next);
    onChange(next);
  };

  return (
    <article className="w-full max-w-[720px] bg-white rounded-[4px] px-16 py-14 box-border font-serif text-ink-2 shadow-[0_1px_3px_rgba(15,27,61,.08),0_12px_32px_rgba(15,27,61,.06)] outline-2 outline-dashed outline-user-mark outline-offset-4">
      <header className="border-b-[1.5px] border-ink-2 pb-3.5 mb-5">
        <div className="text-[28px] font-semibold tracking-[-.01em]">{name || "Your name"}</div>
        <div className="mt-1 font-sans text-muted">
          <LineEditor
            paragraph
            line={value.headline}
            onChange={(l) => update((d) => void (d.headline = l))}
            onRemove={() => update((d) => void (d.headline = withText(d.headline, "")))}
          />
        </div>
        {contact && <div className="text-[12.5px] text-muted mt-1.5 font-sans">{contact}</div>}
      </header>
      {value.sections.map((sec, si) => (
        <section key={si} className="mb-5">
          <h2 className="font-sans text-[11.5px] font-extrabold tracking-[.1em] uppercase text-brand m-0 mb-2.5">
            {sec.title}
          </h2>
          {sec.entries.map((e, ei) => {
            const paragraph = !e.role && !e.org;
            return (
              <div key={ei} className="mb-3">
                {e.role && (
                  <div className="flex justify-between items-baseline gap-3 font-sans">
                    <span className="font-bold text-[14px]">
                      {e.role}
                      {e.org && <span className="font-medium text-muted"> · {e.org}</span>}
                    </span>
                    <span className="text-[12px] text-faint whitespace-nowrap">{e.dates}</span>
                  </div>
                )}
                <div className="mt-1.5 flex flex-col gap-0.5">
                  {e.bullets.map((b, bi) => (
                    <LineEditor
                      key={bi}
                      paragraph={paragraph}
                      line={b}
                      onChange={(l) => update((d) => void (d.sections[si].entries[ei].bullets[bi] = l))}
                      onRemove={() =>
                        update((d) => {
                          const bullets = d.sections[si].entries[ei].bullets;
                          // Lines you added yourself just go away; others are kept as "removed" for the diff.
                          if (!bullets[bi].original && !bullets[bi].text) bullets.splice(bi, 1);
                          else bullets[bi] = withText(bullets[bi], "");
                        })
                      }
                    />
                  ))}
                </div>
                <button
                  onClick={() =>
                    update(
                      (d) =>
                        void d.sections[si].entries[ei].bullets.push({ original: "", text: "", edited: "New line" }),
                    )
                  }
                  className={`${tool} text-brand mt-1`}
                >
                  + Add line
                </button>
              </div>
            );
          })}
        </section>
      ))}
    </article>
  );
}
