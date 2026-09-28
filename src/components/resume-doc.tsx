import { diffWords } from "diff";
import type { Resume, TailoredLine, TailoredResume } from "@/lib/types";

type Seg = { t: string; k: "s" | "a" | "d" };
type Line = { segs: Seg[]; removed: boolean; changed: boolean };
type DocModel = {
  headline: Line;
  sections: { title: string; entries: { role: string; org: string; dates: string; bullets: Line[] }[] }[];
};

function plain(t: string): Line {
  return { segs: [{ t, k: "s" }], removed: false, changed: false };
}

function diffLine({ original, text }: TailoredLine): Line {
  if (original === text) return plain(text);
  if (!text) return { segs: [{ t: original, k: "d" }], removed: true, changed: true };
  if (!original) return { segs: [{ t: text, k: "a" }], removed: false, changed: true };
  const segs = diffWords(original, text).map((p) => ({ t: p.value, k: p.added ? "a" : p.removed ? "d" : "s" }) as Seg);
  return { segs, removed: false, changed: true };
}

export function baseModel(r: Resume): DocModel {
  return {
    headline: plain(r.headline),
    sections: r.sections.map((s) => ({
      title: s.title,
      entries: s.entries.map((e) => ({ ...e, bullets: e.bullets.filter(Boolean).map(plain) })),
    })),
  };
}

export function tailoredModel(t: TailoredResume): DocModel {
  return {
    headline: diffLine(t.headline),
    sections: t.sections.map((s) => ({
      title: s.title,
      entries: s.entries.map((e) => ({ ...e, bullets: e.bullets.map(diffLine) })),
    })),
  };
}

export function countChanges(m: DocModel) {
  let n = m.headline.changed ? 1 : 0;
  for (const s of m.sections) for (const e of s.entries) for (const b of e.bullets) if (b.changed) n++;
  return n;
}

function Segs({ line, showDiff }: { line: Line; showDiff: boolean }) {
  return line.segs.map((sg, i) => {
    if (sg.k === "s") return <span key={i}>{sg.t}</span>;
    if (sg.k === "a")
      return (
        <span key={i} className={`diff-add ${showDiff ? "bg-ok-mark rounded-[3px] px-0.5 [box-decoration-break:clone]" : ""}`}>
          {sg.t}
        </span>
      );
    if (!showDiff) return null;
    return (
      <span
        key={i}
        className="diff-del bg-bad-mark text-[#9a3232] line-through rounded-[3px] px-0.5 [box-decoration-break:clone]"
      >
        {sg.t}
      </span>
    );
  });
}

export function ResumeDoc({
  model,
  name,
  contact,
  showDiff,
  dim,
}: {
  model: DocModel;
  name: string;
  contact: string;
  showDiff: boolean;
  dim?: boolean;
}) {
  return (
    <article
      className="print-doc w-full max-w-[720px] bg-white rounded-[4px] px-16 py-14 box-border font-serif text-ink-2 transition-opacity duration-300 shadow-[0_1px_3px_rgba(15,27,61,.08),0_12px_32px_rgba(15,27,61,.06)]"
      style={{ opacity: dim ? 0.4 : 1 }}
    >
      <header className="border-b-[1.5px] border-ink-2 pb-3.5 mb-5">
        <div className="text-[28px] font-semibold tracking-[-.01em]">{name || "Your name"}</div>
        <div className="text-[13.5px] text-muted mt-1 font-sans">
          <Segs line={model.headline} showDiff={showDiff} />
        </div>
        {contact && <div className="text-[12.5px] text-muted mt-1.5 font-sans">{contact}</div>}
      </header>
      {model.sections.map((sec, si) => (
        <section key={si} className="mb-5">
          <h2 className="font-sans text-[11.5px] font-extrabold tracking-[.1em] uppercase text-brand m-0 mb-2.5">
            {sec.title}
          </h2>
          {sec.entries.map((e, ei) => (
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
              <ul className="mt-1.5 mb-0 pl-[18px] flex flex-col gap-1 list-disc">
                {e.bullets.map((b, bi) =>
                  b.removed && !showDiff ? null : (
                    <li key={bi} className={`text-[13.5px] leading-[1.55] ${b.removed ? "diff-del" : ""}`}>
                      <Segs line={b} showDiff={showDiff} />
                    </li>
                  ),
                )}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </article>
  );
}
