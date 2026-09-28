import type { Resume } from "./types";

type Entryish = { role: string; org: string; dates: string };
type Tailoredish<E extends Entryish> = { sections: { title: string; entries: E[] }[] };

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const entryKey = (e: Entryish) => norm(`${e.role}|${e.org}|${e.dates}`);

function take<T>(pool: T[], key: (x: T) => string, want: string) {
  const i = pool.findIndex((x) => key(x) === want);
  return i < 0 ? undefined : pool.splice(i, 1)[0];
}

// Force sections and entries into the base resume's order: the user owns the timeline, the model
// only gets to reorder bullets. Anything that doesn't match the base keeps its relative order at the end.
export function alignToBase<E extends Entryish, T extends Tailoredish<E>>(t: T, base: Resume): T {
  const sectionPool = [...t.sections];
  const sections: T["sections"] = [];
  for (const bs of base.sections) {
    const ts = take(sectionPool, (s) => norm(s.title), norm(bs.title));
    if (!ts) continue;
    const entryPool = [...ts.entries];
    const entries = bs.entries.flatMap((be) => take(entryPool, entryKey, entryKey(be)) ?? []);
    sections.push({ ...ts, entries: [...entries, ...entryPool] });
  }
  return { ...t, sections: [...sections, ...sectionPool] };
}
