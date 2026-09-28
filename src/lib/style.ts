// Punctuation that reads as machine-written. Enforced on every model output, not just requested.
export const STYLE_RULES = `Punctuation rules (mandatory):
- Never use em dashes (—), horizontal bars (―), double hyphens (--), or en dashes (–) as sentence punctuation. Use a comma, period, colon, semicolon, or parentheses instead.
- En dashes are allowed only inside number/date ranges (e.g. 2019–2021, Jan 2024 – present).
- Never use ellipses (…).`;

export function scrub(s: string): string {
  return (
    s
      // em dash / horizontal bar / double hyphen used as a break → comma
      .replace(/\s*(?:—|―|(?<!-)--(?!-))\s*/g, ", ")
      // spaced en dash used as a break (but keep "2021 – present", "Jan 2024 – Jul 2024")
      .replace(/(?<!\d)\s+–\s+(?![\dA-Z][a-z]{0,2}\s?\d|present\b)/gi, ", ")
      // unspaced en dash joining words (self–serve) → hyphen
      .replace(/(?<=\p{L})–(?=\p{L})/gu, "-")
      .replace(/…/g, "...")
      // tidy up what the replacements can leave behind
      .replace(/,\s*,/g, ",")
      .replace(/\s+,/g, ",")
      .replace(/,\s*([.;:!?)])/g, "$1")
      .replace(/^\s*,\s*|\s*,\s*$/g, "")
  );
}
