import "server-only";
import path from "node:path";
import { Document, Font, Link, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import { linkify } from "./linkify";
import type { Entry, Resume } from "./types";

// Same faces as the on-screen document (see app/layout.tsx), embedded so the PDF looks the same everywhere.
const font = (file: string) => path.join(process.cwd(), "src/assets/fonts", file);
Font.register({
  family: "Source Serif 4",
  fonts: [{ src: font("SourceSerif4-Regular.ttf") }, { src: font("SourceSerif4-SemiBold.ttf"), fontWeight: 600 }],
});
Font.register({
  family: "Plus Jakarta Sans",
  fonts: [
    { src: font("PlusJakartaSans-Regular.ttf") },
    { src: font("PlusJakartaSans-Medium.ttf"), fontWeight: 500 },
    { src: font("PlusJakartaSans-Bold.ttf"), fontWeight: 700 },
    { src: font("PlusJakartaSans-ExtraBold.ttf"), fontWeight: 800 },
  ],
});
// Never break words: the hyphens react-pdf inserts would end up in the text an ATS reads.
Font.registerHyphenationCallback((word) => [word]);

const INK = "#1b2340";
const MUTED = "#4a5578";
const SUBTLE = "#6b7592";
const BRAND = "#1a6fe8";
const SANS = "Plus Jakarta Sans";

// One column, top to bottom, real text only: the order on the page is the order a parser reads.
const s = StyleSheet.create({
  page: { paddingVertical: 46, paddingHorizontal: 52, fontFamily: "Source Serif 4", fontSize: 10, lineHeight: 1.5, color: INK },
  header: { borderBottomWidth: 1.2, borderBottomColor: INK, paddingBottom: 10, marginBottom: 14 },
  name: { fontSize: 22, fontWeight: 600, letterSpacing: -0.2, lineHeight: 1.15 },
  headline: { fontFamily: SANS, fontSize: 10, color: MUTED, marginTop: 4 },
  contact: { fontFamily: SANS, fontSize: 9, color: MUTED, marginTop: 5 },
  link: { color: BRAND, textDecoration: "none" },
  sectionTitle: {
    fontFamily: SANS,
    fontSize: 8.5,
    fontWeight: 800,
    // No letter-spacing: text extractors read tracked capitals as "S U M M A R Y".
    textTransform: "uppercase",
    color: BRAND,
    marginBottom: 7,
  },
  entry: { marginTop: 8 },
  sectionStart: { marginTop: 20 },
  entryHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 10, fontFamily: SANS },
  role: { flex: 1, fontSize: 10.5, fontWeight: 700 },
  org: { fontWeight: 500, color: MUTED },
  dates: { fontSize: 9, color: SUBTLE },
  bullet: { flexDirection: "row", marginTop: 2.5 },
  dot: { width: 13, paddingLeft: 3 },
  line: { flex: 1 },
  para: { marginTop: 4 },
  letter: { fontSize: 11, lineHeight: 1.65 },
  letterPara: { marginBottom: 10 },
});

function Rich({ text, bare }: { text: string; bare?: boolean }) {
  return linkify(text, bare).map((p, i) =>
    p.href ? (
      <Link key={i} src={p.href} style={s.link}>
        {p.text}
      </Link>
    ) : (
      p.text
    ),
  );
}

function Header({ resume, headline }: { resume: Resume; headline?: boolean }) {
  return (
    <View style={s.header}>
      <Text style={s.name}>{resume.name}</Text>
      {headline && !!resume.headline && (
        <Text style={s.headline}>
          <Rich text={resume.headline} />
        </Text>
      )}
      {!!resume.contact && (
        <Text style={s.contact}>
          <Rich text={resume.contact} bare />
        </Text>
      )}
    </View>
  );
}

// One resume entry. Page breaks fall between lines, never inside one, and a heading (the section title
// on a section's first entry, then the role) always stays with the line that follows it. Everything is
// a direct child of the page: react-pdf overlaps text when an unbreakable block is nested in a breakable one.
function EntryBlock({ entry: e, title, first }: { entry: Entry; title?: string; first: boolean }) {
  const list = !!(e.role || e.org);
  const lines = e.bullets.map((b, i) =>
    list ? (
      <View key={i} style={s.bullet} wrap={i === 0}>
        <Text style={s.dot}>•</Text>
        <Text style={s.line}>
          <Rich text={b} />
        </Text>
      </View>
    ) : (
      // No role/org (Summary, Skills, …): plain paragraphs, one per line.
      <Text key={i} style={i > 0 ? s.para : undefined}>
        <Rich text={b} />
      </Text>
    ),
  );
  return (
    <>
      <View style={first ? undefined : title ? s.sectionStart : s.entry} wrap={false}>
        {!!title && <Text style={s.sectionTitle}>{title}</Text>}
        {!!e.role && (
          <View style={s.entryHead}>
            <Text style={s.role}>
              {e.role}
              {!!e.org && <Text style={s.org}> · {e.org}</Text>}
            </Text>
            <Text style={s.dates}>{e.dates}</Text>
          </View>
        )}
        {lines[0]}
      </View>
      {lines.slice(1)}
    </>
  );
}

const EMPTY_ENTRY: Entry = { role: "", org: "", dates: "", bullets: [] };

// Mirrors components/resume-doc.tsx, minus the diff.
function ResumePdf({ resume, title }: { resume: Resume; title: string }) {
  return (
    <Document title={title} author={resume.name} subject="Resume" language="en-US">
      <Page size="LETTER" style={s.page}>
        <Header resume={resume} headline />
        {resume.sections.map((sec, si) =>
          (sec.entries.length ? sec.entries : [EMPTY_ENTRY]).map((e, ei) => (
            <EntryBlock key={`${si}.${ei}`} entry={e} title={ei === 0 ? sec.title : undefined} first={si + ei === 0} />
          )),
        )}
      </Page>
    </Document>
  );
}

function CoverPdf({ resume, paragraphs, date, title }: { resume: Resume; paragraphs: string[]; date: string; title: string }) {
  return (
    <Document title={title} author={resume.name} subject="Cover letter" language="en-US">
      <Page size="LETTER" style={[s.page, s.letter]}>
        <Header resume={resume} />
        <Text style={{ marginBottom: 16 }}>{date}</Text>
        {paragraphs.map((p, i) => (
          <Text key={i} style={s.letterPara}>
            <Rich text={p} />
          </Text>
        ))}
        <Text style={{ marginTop: 6 }} wrap={false}>
          Warmly,{"\n"}
          {resume.name}
        </Text>
      </Page>
    </Document>
  );
}

export function renderResumePdf(resume: Resume, title: string) {
  return renderToBuffer(<ResumePdf resume={resume} title={title} />);
}

export function renderCoverPdf(resume: Resume, paragraphs: string[], date: string, title: string) {
  return renderToBuffer(<CoverPdf resume={resume} paragraphs={paragraphs} date={date} title={title} />);
}
