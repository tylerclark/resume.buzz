export type TextPart = { text: string; href?: string };

const EMAIL = String.raw`[\w.+-]+@[\w-]+(?:\.[\w-]+)+`;
const URL = String.raw`(?:https?:\/\/|www\.)[^\s<>()]+`;
// "tylerclark.com", "linkedin.com/in/tyler". Only safe where a link is expected: in running text it
// would also catch "Node.js" and "ASP.NET".
const BARE = String.raw`(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>()]*)?`;

// Split text into plain parts and links (emails → mailto:, URLs → https). `bare` also links domains
// written without a scheme, for the contact line.
export function linkify(text: string, bare = false): TextPart[] {
  const re = new RegExp([EMAIL, URL, ...(bare ? [BARE] : [])].join("|"), "gi");
  const parts: TextPart[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const hit = m[0].replace(/[.,;:!?]+$/, ""); // sentence punctuation isn't part of the link
    if (m.index > last) parts.push({ text: text.slice(last, m.index) });
    const href = hit.includes("@") && !/^https?:/i.test(hit) ? `mailto:${hit}` : /^https?:/i.test(hit) ? hit : `https://${hit}`;
    parts.push({ text: hit, href });
    last = m.index + hit.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}
