import type { job } from "@/db/schema";
import { DEFAULT_PROMPT, resumeHash, type JobRequirement, type Resume, type StoredTailored } from "./types";

// Sample jobs the demo user starts with, already tailored, so there is something to show before any
// posting is pasted in. Entirely fictional, like the resume they're tailored from: the companies, the
// postings and the links. One arrives through the API (unopened), to show the API badge and triage card.

type Sample = {
  slug: string;
  daysAgo: number;
  url: string;
  title: string;
  company: string;
  location: string;
  pay: string;
  level: string;
  score: number;
  scoreNote: string;
  requirements: JobRequirement[];
  tailoredScore: number;
  tailoredScoreNote: string;
  tailoredRequirements: JobRequirement[];
  keywordsHit: string[];
  keywordsMissing: string[];
  // The tailored headline, and base bullet → its tailored wording. Bullets not listed are unchanged.
  headline: string;
  edits: Record<string, string>;
  raw: string;
  applied?: boolean;
  coverPrompt?: string;
  coverLetter?: string[];
  source?: string;
  notes?: string;
};

const SAMPLES: Sample[] = [
  {
    slug: "harborline",
    daysAgo: 3,
    url: "https://careers.example.com/harborline-pay/senior-frontend-engineer",
    title: "Senior Frontend Engineer",
    company: "Harborline Pay",
    location: "Remote (US)",
    pay: "$165k–$190k",
    level: "Senior",
    score: 76,
    scoreNote:
      "Strong on React, TypeScript, performance and testing, with real mentoring experience. No payments background and no evidence of design system or accessibility work beyond a skills mention.",
    requirements: [
      { status: "hit", text: "5+ years building production web apps with React and TypeScript" },
      { status: "hit", text: "Measurable web performance wins (dashboard load cut from 3.8s to 1.1s)" },
      { status: "hit", text: "End-to-end testing of critical flows (Playwright)" },
      { status: "hit", text: "Mentoring engineers and taking part in hiring" },
      { status: "partial", text: "Accessibility to WCAG 2.1 AA: listed as a skill, no project evidence" },
      { status: "miss", text: "Owning or contributing to a design system" },
      { status: "miss", text: "Payments or fintech experience" },
    ],
    tailoredScore: 86,
    tailoredScoreNote:
      "The tailored resume leads with customer-facing React and TypeScript work and puts the performance and testing results in the posting's terms. Design system and payments experience are still missing.",
    tailoredRequirements: [
      { status: "hit", text: "5+ years building production web apps with React and TypeScript" },
      { status: "hit", text: "Measurable web performance wins (dashboard load cut from 3.8s to 1.1s)" },
      { status: "hit", text: "End-to-end testing of critical flows (Playwright)" },
      { status: "hit", text: "Mentoring engineers and taking part in hiring" },
      { status: "partial", text: "Accessibility to WCAG 2.1 AA: listed as a skill, no project evidence" },
      { status: "miss", text: "Owning or contributing to a design system" },
      { status: "miss", text: "Payments or fintech experience" },
    ],
    keywordsHit: ["React", "TypeScript", "Next.js", "Web performance", "Playwright", "Accessibility", "Mentoring"],
    keywordsMissing: ["Design system", "Storybook", "Payments", "Core Web Vitals"],
    headline: "Senior Software Engineer building fast, accessible web products with React, TypeScript and Next.js",
    edits: {
      "Lead a team of five engineers building the shipment tracking platform used by 4,000 business customers.":
        "Lead a team of five engineers building the customer-facing shipment tracking web app used by 4,000 business customers.",
      "Rebuilt the customer dashboard in React and TypeScript, cutting median page load from 3.8s to 1.1s.":
        "Rebuilt the customer dashboard in React and TypeScript, improving web performance by cutting median page load from 3.8s to 1.1s.",
      "Mentor three mid-level engineers and run the team's hiring loop for frontend roles.":
        "Mentor three mid-level engineers through code review and pairing, and run the team's hiring loop for frontend roles.",
      "Added end-to-end tests with Playwright and raised coverage of critical flows from 40% to 85%.":
        "Added end-to-end testing with Playwright, raising automated coverage of critical user flows from 40% to 85%.",
      "Frontend: React, Next.js, Tailwind CSS, accessibility":
        "Frontend: React, TypeScript, Next.js, Tailwind CSS, web accessibility",
    },
    applied: true,
    coverPrompt: "Confident but not salesy. Under 250 words.",
    coverLetter: [
      "I'm a senior engineer who has spent the last ten years building web products in React and TypeScript, and the Senior Frontend Engineer role at Harborline Pay lines up with the work I like most: making a product that businesses rely on every day fast and dependable.",
      "At Northwind Logistics I lead a team of five on the shipment tracking app used by 4,000 business customers. I rebuilt its dashboard in React and TypeScript and cut median page load from 3.8 seconds to 1.1. Before that, at Brightpath Health, I added Playwright tests that took coverage of our critical flows from 40% to 85%, which is the kind of safety net a checkout or payouts flow needs.",
      "I should be plain about two gaps. I haven't worked in payments, and I haven't owned a design system. What I do bring is a habit of measuring before and after, and experience mentoring mid-level engineers and running a frontend hiring loop.",
      "I'd welcome the chance to talk about the merchant dashboard and where it needs to go next.",
    ],
    raw: `Senior Frontend Engineer
Harborline Pay · Remote (US) · Full-time · $165,000–$190,000

About Harborline Pay
Harborline Pay helps small and mid-sized businesses accept payments, send invoices and get paid out faster. More than 30,000 merchants run their day through our dashboard.

The role
You will join the Merchant Experience team, which owns the web dashboard merchants use to track payments, issue refunds and manage payouts. We are looking for a senior engineer who cares about speed, accessibility and craft, and who makes the engineers around them better.

What you'll do
- Build and maintain customer-facing features in React, TypeScript and Next.js.
- Own web performance for the dashboard, with Core Web Vitals as the yardstick.
- Contribute to our design system and its Storybook component library.
- Ship accessible interfaces that meet WCAG 2.1 AA.
- Write end-to-end tests for critical payment flows with Playwright.
- Mentor engineers through code review and pairing, and take part in hiring.

What we're looking for
- 5+ years building production web applications with React and TypeScript.
- A track record of measurable performance improvements.
- Experience with automated testing, including end-to-end tests.
- Experience mentoring other engineers.
- Working knowledge of web accessibility standards.

Nice to have
- Experience in payments or fintech.
- Experience owning or contributing to a design system.

Benefits
Health, dental and vision coverage, a 401(k) match, a home office budget and four weeks of paid time off.`,
  },
  {
    slug: "fernway",
    daysAgo: 1,
    url: "https://careers.example.com/fernway-freight/staff-software-engineer-platform",
    title: "Staff Software Engineer, Platform",
    company: "Fernway Freight",
    location: "Austin, TX · Hybrid",
    pay: "$185k–$215k",
    level: "Staff",
    score: 68,
    scoreNote:
      "Directly relevant logistics and event-driven experience on Node.js and PostgreSQL, plus release engineering. Leadership is at the team level rather than across teams, and there is no Kubernetes, AWS or Kafka.",
    requirements: [
      { status: "hit", text: "8+ years of software engineering experience" },
      { status: "hit", text: "Event-driven services at scale (2 million delivery updates a day)" },
      { status: "hit", text: "Node.js, TypeScript and PostgreSQL in production" },
      { status: "hit", text: "CI/CD and release engineering (trunk-based development, canary deploys)" },
      { status: "partial", text: "Technical leadership across several teams: leads one team of five" },
      { status: "miss", text: "Running services on Kubernetes and AWS" },
      { status: "miss", text: "Kafka or a comparable streaming platform" },
    ],
    tailoredScore: 79,
    tailoredScoreNote:
      "The tailored resume puts the event-driven notification service, the release engineering work and the technical lead role up front in the posting's language. Kubernetes, AWS and Kafka are still gaps.",
    tailoredRequirements: [
      { status: "hit", text: "8+ years of software engineering experience" },
      { status: "hit", text: "Event-driven services at scale (2 million delivery updates a day)" },
      { status: "hit", text: "Node.js, TypeScript and PostgreSQL in production" },
      { status: "hit", text: "CI/CD and release engineering (trunk-based development, canary deploys)" },
      { status: "partial", text: "Technical leadership across several teams: technical lead for one team of five" },
      { status: "miss", text: "Running services on Kubernetes and AWS" },
      { status: "miss", text: "Kafka or a comparable streaming platform" },
    ],
    keywordsHit: ["Event-driven", "Node.js", "TypeScript", "PostgreSQL", "CI/CD", "Canary deploys", "Logistics"],
    keywordsMissing: ["Kubernetes", "AWS", "Kafka", "Observability"],
    headline:
      "Senior Software Engineer building reliable, event-driven logistics platforms with TypeScript, Node.js and PostgreSQL",
    edits: {
      "Lead a team of five engineers building the shipment tracking platform used by 4,000 business customers.":
        "Technical lead for a team of five engineers building the shipment tracking platform used by 4,000 business customers.",
      "Designed an event-driven notification service on Node.js and PostgreSQL that sends 2 million delivery updates a day.":
        "Designed and built an event-driven notification service on Node.js and PostgreSQL that delivers 2 million shipment updates a day.",
      "Introduced trunk-based development and automated canary deploys, taking releases from every two weeks to several a day.":
        "Led the move to trunk-based development and automated canary deploys in CI/CD, taking releases from every two weeks to several a day.",
      "Moved the nightly reporting jobs from cron scripts to a queue, cutting failed runs by 90%.":
        "Moved the nightly reporting jobs from cron scripts to a message queue, improving reliability by cutting failed runs by 90%.",
      "Backend: Node.js, Django, PostgreSQL, Redis, REST and GraphQL APIs":
        "Backend: Node.js, PostgreSQL, Redis, event-driven services, REST and GraphQL APIs, Django",
    },
    raw: `Staff Software Engineer, Platform
Fernway Freight · Austin, TX (hybrid, 2 days a week) · Full-time · $185,000–$215,000

About Fernway Freight
Fernway Freight is a digital freight network that matches shippers with carriers and tracks every load from pickup to delivery. Our platform handles more than 40 million tracking events a day.

The role
The Platform team builds the event pipeline and shared services that every product team at Fernway depends on. As a Staff Engineer you will set technical direction for that platform, lead projects that span several teams and raise the bar for reliability.

What you'll do
- Design and build event-driven services on Node.js, TypeScript and PostgreSQL.
- Evolve our streaming pipeline, built on Kafka, as volume grows.
- Run services on Kubernetes and AWS, and own their reliability and observability.
- Improve CI/CD and release engineering so teams can ship many times a day with canary deploys.
- Lead technical direction across several teams and mentor senior engineers.

What we're looking for
- 8+ years of software engineering experience.
- Experience designing event-driven systems at scale.
- Deep experience with Node.js, TypeScript and PostgreSQL in production.
- Experience running services on Kubernetes and AWS.
- A history of leading technical work across more than one team.

Nice to have
- Experience in logistics, freight or shipment tracking.
- Experience with Kafka or a comparable streaming platform.

Benefits
Equity, health coverage for you and your family, a 401(k) match and a commuter stipend.`,
  },
  {
    slug: "cedar-ridge",
    daysAgo: 0,
    url: "https://careers.example.com/cedar-ridge-health/senior-full-stack-engineer",
    title: "Senior Full-Stack Engineer, Patient Scheduling",
    company: "Cedar Ridge Health",
    location: "Remote (US)",
    pay: "$160k–$185k",
    level: "Senior",
    score: 83,
    scoreNote:
      "Close to a direct match: built a patient scheduling app in React and Django, integrated it with three EHR systems and cut no-shows with SMS reminders. FHIR and HIPAA are not mentioned.",
    requirements: [
      { status: "hit", text: "Full-stack experience with React and Python (Django)" },
      { status: "hit", text: "Has built scheduling or booking software (patient scheduling for 120 clinics)" },
      { status: "hit", text: "Reminder and notification systems (SMS reminders cut no-shows by 18%)" },
      { status: "hit", text: "Automated testing of critical flows (Playwright)" },
      { status: "partial", text: "EHR integrations over HL7 or FHIR: integrated three EHR systems over REST" },
      { status: "miss", text: "Working under HIPAA" },
    ],
    tailoredScore: 91,
    tailoredScoreNote:
      "The tailored resume makes the patient scheduling and EHR integration work unmistakable and uses the posting's own terms. FHIR and HIPAA are still not claimed, because the base resume doesn't support them.",
    tailoredRequirements: [
      { status: "hit", text: "Full-stack experience with React and Python (Django)" },
      { status: "hit", text: "Has built scheduling or booking software (patient scheduling for 120 clinics)" },
      { status: "hit", text: "Reminder and notification systems (SMS reminders cut no-shows by 18%)" },
      { status: "hit", text: "Automated testing of critical flows (Playwright)" },
      { status: "partial", text: "EHR integrations over HL7 or FHIR: integrated three EHR systems over REST" },
      { status: "miss", text: "Working under HIPAA" },
    ],
    keywordsHit: ["React", "TypeScript", "Python", "Django", "Patient scheduling", "EHR integration", "SMS reminders"],
    keywordsMissing: ["FHIR", "HIPAA", "HL7"],
    headline:
      "Senior Software Engineer building reliable healthcare and scheduling products with React, TypeScript and Python",
    edits: {
      "Built the patient scheduling app in React and Python (Django) for a network of 120 clinics.":
        "Built the full-stack patient scheduling app in React and Python (Django), used across a network of 120 clinics.",
      "Cut appointment no-shows by 18% with SMS reminders and a self-service rescheduling flow.":
        "Reduced appointment no-shows by 18% with automated SMS reminders and a self-service patient rescheduling flow.",
      "Wrote the REST API that connects scheduling to three electronic health record systems.":
        "Wrote the REST API that integrates scheduling with three electronic health record (EHR) systems.",
      "Backend: Node.js, Django, PostgreSQL, Redis, REST and GraphQL APIs":
        "Backend: Python (Django), Node.js, PostgreSQL, Redis, REST and GraphQL APIs",
    },
    source: "job-scout",
    notes:
      "Priority: High\nComp: $160k–$185k\nNear-exact match with the Brightpath Health scheduling work: React, Django and EHR integrations. Remote, posted two days ago.",
    raw: `Senior Full-Stack Engineer, Patient Scheduling
Cedar Ridge Health · Remote (US) · Full-time · $160,000–$185,000

About Cedar Ridge Health
Cedar Ridge Health runs 85 primary care clinics across the Mountain West. Our engineering team builds the software patients use to find care and the tools clinic staff use to deliver it.

The role
The Patient Scheduling team owns online booking, reminders and rescheduling. You will work across the stack, from the React app patients see to the Django services that talk to our electronic health record (EHR) systems.

What you'll do
- Build patient-facing scheduling features in React and TypeScript.
- Build and maintain backend services in Python (Django) and PostgreSQL.
- Extend our EHR integrations, which use HL7 and FHIR.
- Improve SMS and email reminders to reduce missed appointments.
- Write automated tests for the flows patients depend on.
- Handle patient data with care, in line with HIPAA.

What we're looking for
- 5+ years of full-stack experience with React and Python.
- Experience building scheduling, booking or similar transactional software.
- Experience integrating with third-party systems through APIs.
- Experience with reminder or notification systems.
- A habit of testing what you ship.

Nice to have
- Experience with EHR integrations, HL7 or FHIR.
- Experience working under HIPAA.

Benefits
Health, dental and vision coverage, a 401(k) match, a learning budget and flexible hours.`,
  },
];

// The base resume with one sample's rewording applied, in the shape the tailoring step stores.
function tailor(base: Resume, s: Sample): StoredTailored {
  const line = (original: string) => ({ original, text: s.edits[original] ?? original });
  return {
    headline: { original: base.headline, text: s.headline },
    sections: base.sections.map((sec) => ({
      title: sec.title,
      entries: sec.entries.map((e) => ({ ...e, bullets: e.bullets.map(line) })),
    })),
    keywordsHit: s.keywordsHit,
    keywordsMissing: s.keywordsMissing,
  };
}

// Rows for the demo user `userId`, tailored from `base`. Ids are stable per user, so seeding again
// leaves existing rows alone and only brings back samples that were deleted.
export function demoJobRows(userId: string, base: Resume): (typeof job.$inferInsert)[] {
  const baseHash = resumeHash(base);
  return SAMPLES.map((s) => {
    const createdAt = new Date(Date.now() - s.daysAgo * 86_400_000);
    const appliedAt = s.applied ? new Date(createdAt.getTime() + 86_400_000) : null;
    return {
      id: `${userId}_${s.slug}`,
      userId,
      url: s.url,
      title: s.title,
      company: s.company,
      location: s.location,
      pay: s.pay,
      employmentType: "Full-time",
      level: s.level,
      score: s.score,
      scoreNote: s.scoreNote,
      requirements: s.requirements,
      tailoredScore: s.tailoredScore,
      tailoredScoreNote: s.tailoredScoreNote,
      tailoredRequirements: s.tailoredRequirements,
      keywordsHit: s.keywordsHit,
      keywordsMissing: s.keywordsMissing,
      raw: s.raw,
      prompt: DEFAULT_PROMPT,
      tailored: tailor(base, s),
      baseHash,
      status: s.applied ? "applied" : "not_applied",
      statusAt: appliedAt,
      appliedAt,
      stage: "done",
      coverPrompt: s.coverPrompt ?? "",
      coverLetter: s.coverLetter ?? null,
      source: s.source ?? "app",
      notes: s.notes ?? "",
      createdAt,
      updatedAt: appliedAt ?? createdAt,
    };
  });
}
