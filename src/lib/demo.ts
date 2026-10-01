import "server-only";
import { db } from "@/db";
import { baseResume, job, user } from "@/db/schema";
import { demoJobRows } from "./demo-jobs";
import type { Resume } from "./types";

// Demo mode lets you show the app without showing your own resume. Turning it on swaps the signed-in
// user for a shadow "demo" user that owns a made-up base resume and its own jobs, facts and tokens.
// Every read and write is already scoped by user id, so nothing of the real account can load while
// it's on, and nothing done in the demo touches the real account.

// Holds the id of the user who turned demo mode on, so it never carries over to another sign-in.
export const DEMO_COOKIE = "rb_demo";

export const DEMO_USER = { name: "Alex Morgan", email: "alex.morgan@example.com" };

export const demoUserId = (userId: string) => `demo_${userId}`;

export type AppUser = { id: string; name: string; email: string; demo: boolean };

// The user the app should act as: the demo user when this browser has demo mode on for `real`.
export function effectiveUser(real: { id: string; name: string; email: string }, cookieHeader: string | null): AppUser {
  const raw = cookieHeader?.split(/;\s*/).find((c) => c.startsWith(`${DEMO_COOKIE}=`));
  const on = !!raw && decodeURIComponent(raw.slice(DEMO_COOKIE.length + 1)) === real.id;
  return on
    ? { id: demoUserId(real.id), ...DEMO_USER, demo: true }
    : { id: real.id, name: real.name, email: real.email, demo: false };
}

// Creates the shadow user, its resume and a few sample jobs the first time demo mode is turned on. Edits
// made to the demo resume or the sample jobs afterwards are kept; a sample job that was deleted comes
// back the next time demo mode is turned on. The stored email is unique per account and can't sign in
// (example.com is never on the allowlist).
export async function ensureDemoUser(userId: string) {
  const id = demoUserId(userId);
  await db
    .insert(user)
    .values({ id, name: DEMO_USER.name, email: `demo+${userId}@example.com` })
    .onConflictDoNothing();
  await db.insert(baseResume).values({ userId: id, data: DEMO_RESUME }).onConflictDoNothing();
  await db.insert(job).values(demoJobRows(id, DEMO_RESUME)).onConflictDoNothing();
}

// Entirely fictional: the person, the employers and the numbers.
export const DEMO_RESUME: Resume = {
  name: DEMO_USER.name,
  headline: "Senior Software Engineer building reliable web products with TypeScript, React and Node.js",
  contact: `Austin, TX · ${DEMO_USER.email} · (555) 010-0142`,
  sections: [
    {
      title: "Experience",
      entries: [
        {
          role: "Senior Software Engineer",
          org: "Northwind Logistics",
          dates: "2021 – present",
          bullets: [
            "Lead a team of five engineers building the shipment tracking platform used by 4,000 business customers.",
            "Rebuilt the customer dashboard in React and TypeScript, cutting median page load from 3.8s to 1.1s.",
            "Designed an event-driven notification service on Node.js and PostgreSQL that sends 2 million delivery updates a day.",
            "Introduced trunk-based development and automated canary deploys, taking releases from every two weeks to several a day.",
            "Mentor three mid-level engineers and run the team's hiring loop for frontend roles.",
          ],
        },
        {
          role: "Software Engineer",
          org: "Brightpath Health",
          dates: "2018 – 2021",
          bullets: [
            "Built the patient scheduling app in React and Python (Django) for a network of 120 clinics.",
            "Cut appointment no-shows by 18% with SMS reminders and a self-service rescheduling flow.",
            "Wrote the REST API that connects scheduling to three electronic health record systems.",
            "Added end-to-end tests with Playwright and raised coverage of critical flows from 40% to 85%.",
          ],
        },
        {
          role: "Junior Web Developer",
          org: "Lumen Analytics",
          dates: "2016 – 2018",
          bullets: [
            "Built reporting dashboards in JavaScript and D3 for marketing agency clients.",
            "Moved the nightly reporting jobs from cron scripts to a queue, cutting failed runs by 90%.",
            "Handled customer support escalations and turned the most common ones into product fixes.",
          ],
        },
      ],
    },
    {
      title: "Skills",
      entries: [
        {
          role: "",
          org: "",
          dates: "",
          bullets: [
            "Languages: TypeScript, JavaScript, Python, SQL",
            "Frontend: React, Next.js, Tailwind CSS, accessibility",
            "Backend: Node.js, Django, PostgreSQL, Redis, REST and GraphQL APIs",
            "Practices: CI/CD, automated testing, code review, mentoring, agile delivery",
          ],
        },
      ],
    },
    {
      title: "Education",
      entries: [
        {
          role: "B.S. Computer Science",
          org: "Lakeview State University",
          dates: "2012 – 2016",
          bullets: [],
        },
      ],
    },
  ],
};
