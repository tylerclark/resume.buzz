import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { getSession } from "@/lib/auth";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  const dest = typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  if (await getSession()) redirect(dest);

  return (
    <main className="min-h-screen grid place-items-center px-4">
      <div className="w-full max-w-[380px] md:max-w-[784px] flex flex-col gap-6">
        <div className="flex justify-center">
          <Logo variant="stacked" height={190} priority />
        </div>
        <div className="grid gap-6 md:grid-cols-2">
        <div className="bg-surface border border-line-2 rounded-[14px] p-6 flex flex-col gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="m-0 text-[20px] font-extrabold tracking-[-.02em]">Sign in</h1>
              <span className="eyebrow rounded-full bg-brand/10 text-brand px-2 py-[2px]">Private beta</span>
            </div>
            <p className="m-0 mt-1 text-[13px] text-muted">
              Invite only for now. If your email is on the list, we&apos;ll send you a 6-digit code. No password.
            </p>
          </div>
          <LoginForm next={dest} />
        </div>
        <section className="bg-surface border border-line-2 rounded-[14px] p-6 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <h2 className="m-0 text-[20px] font-extrabold tracking-[-.02em]">Open source</h2>
            <span className="eyebrow rounded-full bg-ok-bg text-ok-ink px-2 py-[2px]">MIT</span>
          </div>
          <p className="m-0 text-[13px] text-muted">
            Paste a job posting, get your resume tailored to it. Every line of code is public, and you can run your
            own copy for free.
          </p>
          <ul className="m-0 pl-4 list-disc flex flex-col gap-1 text-[12.5px] text-muted">
            <li>Word-level diff of every change, with an honest before/after match score</li>
            <li>Fills keyword gaps only with experience you confirm, never invents</li>
            <li>Cover letters, application tracking and PDF export</li>
            <li>Self-host on free tiers of Neon, Resend, Firecrawl and Vercel</li>
          </ul>
          <a
            href={REPO}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 flex items-center justify-center gap-2 border border-line-2 hover:border-line-3 rounded-[10px] h-[40px] text-[13.5px] font-bold text-ink no-underline"
          >
            <GitHubMark className="size-4" />
            tylerclark/resume.buzz
          </a>
          <p className="m-0 text-[12px] text-subtle text-center">
            Stars, issues and pull requests welcome.
          </p>
        </section>
        </div>
      </div>
    </main>
  );
}

const REPO = "https://github.com/tylerclark/resume.buzz";

function GitHubMark({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" fill="currentColor" className={`block ${className}`}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
