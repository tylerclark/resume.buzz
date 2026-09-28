import { diffWords } from "diff";
import { finalText, type Resume, type StoredLine, type StoredTailored } from "@/lib/types";

// s = unchanged from base · a/d = AI added/removed · u/x = you added/removed
type Kind = "s" | "a" | "d" | "u" | "x";
type Seg = { t: string; k: Kind };
type Line = { segs: Seg[]; removed: boolean; changed: boolean; userEdited: boolean };
type DocModel = {
  headline: Line;
  sections: { title: string; entries: { role: string; org: string; dates: string; bullets: Line[] }[] }[];
};

function plain(t: string): Line {
  return { segs: [{ t, k: "s" }], removed: false, changed: false, userEdited: false };
}

function merge(segs: Seg[]) {
  const out: Seg[] = [];
  for (const sg of segs) {
    if (!sg.t) continue;
    const last = out[out.length - 1];
    if (last?.k === sg.k) last.t += sg.t;
    else out.push({ ...sg });
  }
  return out;
}

// Diff base → AI, then layer the AI → user diff on top so each change keeps its author.
function diff3(original: string, ai: string, final: string): Seg[] {
  const stream: Seg[] = diffWords(original, ai).map((p) => ({
    t: p.value,
    k: p.added ? "a" : p.removed ? "d" : "s",
  }));
  if (final === ai) return merge(stream);

  const out: Seg[] = [];
  let i = 0;
  let off = 0; // chars consumed within stream[i]
  // Consume n chars of AI text, labeling them with `as` (or their original label), passing through AI deletions.
  const take = (n: number, as?: Kind) => {
    while (i < stream.length && (n > 0 || stream[i].k === "d")) {
      const item = stream[i];
      if (item.k === "d") {
        out.push(item);
        i++;
        continue;
      }
      const chunk = item.t.slice(off, off + n);
      out.push({ t: chunk, k: as ?? item.k });
      n -= chunk.length;
      off += chunk.length;
      if (off >= item.t.length) {
        i++;
        off = 0;
      }
    }
  };
  for (const p of diffWords(ai, final)) {
    if (p.added) out.push({ t: p.value, k: "u" });
    else take(p.value.length, p.removed ? "x" : undefined);
  }
  take(0);
  return merge(out);
}

function diffLine(line: StoredLine): Line {
  const final = finalText(line);
  const userEdited = line.edited !== undefined && line.edited !== line.text;
  if (!userEdited && line.original === line.text) return plain(line.text);
  return {
    segs: diff3(line.original, line.text, final),
    removed: !final,
    changed: final !== line.original,
    userEdited,
  };
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

export function tailoredModel(t: StoredTailored): DocModel {
  return {
    headline: diffLine(t.headline),
    sections: t.sections.map((s) => ({
      title: s.title,
      entries: s.entries.map((e) => ({ ...e, bullets: e.bullets.map(diffLine) })),
    })),
  };
}

export function countChanges(m: DocModel) {
  const lines = [m.headline, ...m.sections.flatMap((s) => s.entries.flatMap((e) => e.bullets))];
  return {
    total: lines.filter((l) => l.changed || l.userEdited).length,
    user: lines.filter((l) => l.userEdited).length,
  };
}

const MARK = "rounded-[3px] px-0.5 [box-decoration-break:clone]";
export const DIFF_STYLES: Record<Exclude<Kind, "s">, { cls: string; label: string; swatch: string }> = {
  a: { cls: `diff-add bg-ok-mark ${MARK}`, label: "AI added", swatch: "bg-ok-mark" },
  d: { cls: `diff-del bg-bad-mark text-[#9a3232] line-through ${MARK}`, label: "AI removed", swatch: "bg-bad-mark" },
  u: { cls: `diff-add bg-user-mark ${MARK}`, label: "You added", swatch: "bg-user-mark" },
  x: { cls: `diff-del bg-user-del text-user-ink line-through ${MARK}`, label: "You removed", swatch: "bg-user-del" },
};

function Segs({ line, showDiff }: { line: Line; showDiff: boolean }) {
  return line.segs.map((sg, i) => {
    if (sg.k === "s") return <span key={i}>{sg.t}</span>;
    const removal = sg.k === "d" || sg.k === "x";
    if (!showDiff) return removal ? null : <span key={i}>{sg.t}</span>;
    return (
      <span key={i} className={DIFF_STYLES[sg.k].cls}>
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
              {e.role || e.org ? (
                <ul className="mt-1.5 mb-0 pl-[18px] flex flex-col gap-1 list-disc">
                  {e.bullets.map((b, bi) =>
                    b.removed && !showDiff ? null : (
                      <li key={bi} className={`text-[13.5px] leading-[1.55] ${b.removed ? "diff-del" : ""}`}>
                        <Segs line={b} showDiff={showDiff} />
                      </li>
                    ),
                  )}
                </ul>
              ) : (
                // No role/org (Summary, Skills, …): plain paragraphs, one per line.
                <div className="flex flex-col gap-1.5">
                  {e.bullets.map((b, bi) =>
                    b.removed && !showDiff ? null : (
                      <p key={bi} className={`m-0 text-[13.5px] leading-[1.55] ${b.removed ? "diff-del" : ""}`}>
                        <Segs line={b} showDiff={showDiff} />
                      </p>
                    ),
                  )}
                </div>
              )}
            </div>
          ))}
        </section>
      ))}
    </article>
  );
}
