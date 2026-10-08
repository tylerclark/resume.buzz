import Link from "next/link";
import { StatusPill } from "@/components/status-picker";
import { requireUser } from "@/lib/auth";
import {
  type Duration,
  getReport,
  GHOSTED_DAYS,
  isReportSource,
  type JobTimeline,
  REPORT_SOURCES,
  type ReportSource,
  WEEKS,
} from "@/lib/reports";
import { companyFromUrl } from "@/lib/types";

export const metadata = { title: "Reports · resume.buzz" };

export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  const user = await requireUser();
  const { source: raw } = await searchParams;
  const source: ReportSource = isReportSource(raw) ? raw : "all";
  const r = await getReport(user.id, source);
  const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "–");
  const heardBack = r.applied - r.awaiting;

  return (
    <main className="flex-1 overflow-y-auto bg-canvas">
      <div className="max-w-[1100px] mx-auto px-6 py-7 flex flex-col gap-6">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-[22px] font-extrabold text-ink">Reports</h1>
            <p className="text-[13px] text-subtle mt-0.5">How your search is going, and how long each step takes.</p>
          </div>
          <SourceFilter source={source} />
        </div>

        <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Stat label={source === "api" ? "Suggested" : "Jobs in"} value={r.total} note={r.untriaged ? `${r.untriaged} not looked at` : undefined} />
          <Stat label="Applied" value={r.applied} note={`${pct(r.applied, r.total)} of jobs in`} />
          <Stat label="Interviewing" value={r.interviewed} note={`${pct(r.interviewed, r.applied)} of applied`} />
          <Stat label="Offers" value={r.offers} note={`${pct(r.offers, r.applied)} of applied`} />
          <Stat label="Rejected" value={r.rejected} note={`${pct(r.rejected, r.applied)} of applied`} />
          <Stat
            label="Awaiting reply"
            value={r.awaiting}
            note={r.ghosted ? `${r.ghosted} silent ${GHOSTED_DAYS}+ days` : undefined}
          />
        </section>

        <div className="grid lg:grid-cols-2 gap-6">
          <Card title="Funnel" sub="Each step as a share of the jobs that came in">
            <Funnel
              total={r.total}
              steps={[
                { label: source === "api" ? "Suggested" : "Jobs in", n: r.total },
                { label: "Applied", n: r.applied },
                { label: "Heard back", n: heardBack },
                { label: "Interviewing", n: r.interviewed },
                { label: "Offer", n: r.offers },
                { label: "Rejected", n: r.rejected, tone: "bad" },
              ]}
            />
            <p className="text-[12px] text-subtle mt-3">
              {r.skipped} passed on without applying · {r.alreadyApplied} blocked by an earlier application · response
              rate {pct(heardBack, r.applied)}
            </p>
          </Card>

          <Card title="Timelines" sub="Days between steps, for jobs you applied to">
            <div className="flex flex-col divide-y divide-line">
              {r.durations.map((d) => (
                <DurationRow key={d.label} d={d} />
              ))}
            </div>
          </Card>
        </div>

        <Card title="Weekly activity" sub={`The last ${WEEKS} weeks, Monday to Sunday`}>
          <div className="flex flex-col gap-4">
            <WeekBars label="Jobs in" weeks={r.weeks} k="added" />
            <WeekBars label="Applied" weeks={r.weeks} k="applied" />
            <WeekBars label="Rejected" weeks={r.weeks} k="rejected" />
          </div>
        </Card>

        <Card title="Applications" sub="Every job you applied to, newest first">
          {r.timelines.length ? (
            <ApplicationsTable rows={r.timelines} />
          ) : (
            <p className="text-[13px] text-subtle">Nothing yet. Mark a job as Applied and it shows up here.</p>
          )}
        </Card>
      </div>
    </main>
  );
}

function SourceFilter({ source }: { source: ReportSource }) {
  return (
    <nav aria-label="Job source" className="flex gap-0.5 p-0.5 bg-well rounded-lg">
      {(Object.keys(REPORT_SOURCES) as ReportSource[]).map((s) => (
        <Link
          key={s}
          href={s === "all" ? "/reports" : `/reports?source=${s}`}
          aria-current={s === source ? "page" : undefined}
          className={`px-3 py-1.5 rounded-md text-[12.5px] font-semibold hover:no-underline transition-colors ${
            s === source ? "bg-surface text-ink shadow-pill" : "text-subtle hover:text-ink"
          }`}
        >
          {REPORT_SOURCES[s]}
        </Link>
      ))}
    </nav>
  );
}

function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="bg-surface border border-line rounded-[12px] p-5">
      <h2 className="text-[14px] font-bold text-ink">{title}</h2>
      {sub && <p className="text-[12px] text-subtle mt-0.5 mb-4">{sub}</p>}
      {children}
    </section>
  );
}

function Stat({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="bg-surface border border-line rounded-[12px] px-4 py-3.5">
      <div className="text-[11px] font-bold text-faint uppercase tracking-[.06em]">{label}</div>
      <div className="text-[28px] font-extrabold text-ink leading-tight tabular-nums">{value}</div>
      <div className="text-[11.5px] text-subtle min-h-[1.2em]">{note}</div>
    </div>
  );
}

function Funnel({ total, steps }: { total: number; steps: { label: string; n: number; tone?: "bad" }[] }) {
  return (
    <div className="flex flex-col gap-2">
      {steps.map((s) => (
        <div key={s.label} className="grid grid-cols-[110px_1fr_44px] items-center gap-3" title={`${s.label}: ${s.n}`}>
          <span className="text-[12.5px] font-semibold text-muted">{s.label}</span>
          <span className="h-5 bg-well rounded-[4px] overflow-hidden">
            <span
              className={`block h-full rounded-[4px] ${s.tone === "bad" ? "bg-bad" : "bg-brand"}`}
              style={{ width: total ? `${Math.max((s.n / total) * 100, s.n ? 1.5 : 0)}%` : 0 }}
            />
          </span>
          <span className="text-[12.5px] font-bold text-ink tabular-nums text-right">{s.n}</span>
        </div>
      ))}
    </div>
  );
}

const fmtDays = (d: number) => (d < 1 ? "<1d" : `${Math.round(d)}d`);

function DurationRow({ d }: { d: Duration }) {
  const sorted = [...d.days].sort((a, b) => a - b);
  const n = sorted.length;
  const median = n ? (n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2) : 0;
  const avg = n ? sorted.reduce((a, b) => a + b, 0) / n : 0;
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-3 py-2.5 first:pt-0 last:pb-0">
      <div>
        <div className="text-[13px] font-semibold text-ink">{d.label}</div>
        <div className="text-[11.5px] text-subtle">
          {d.hint}
          {n ? ` · ${n} job${n === 1 ? "" : "s"}` : ""}
        </div>
      </div>
      {n ? (
        <div className="text-right">
          <div className="text-[18px] font-extrabold text-ink tabular-nums" title="Median">
            {fmtDays(median)}
          </div>
          <div className="text-[11px] text-subtle tabular-nums">
            avg {fmtDays(avg)} · {fmtDays(sorted[0])}–{fmtDays(sorted[n - 1])}
          </div>
        </div>
      ) : (
        <div className="text-[12px] text-faint">No data yet</div>
      )}
    </div>
  );
}

const shortDate = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

function WeekBars({
  label,
  weeks,
  k,
}: {
  label: string;
  weeks: { start: Date; added: number; applied: number; rejected: number }[];
  k: "added" | "applied" | "rejected";
}) {
  const max = Math.max(1, ...weeks.map((w) => w[k]));
  const sum = weeks.reduce((a, w) => a + w[k], 0);
  return (
    <div className="grid grid-cols-[110px_1fr] gap-3 items-end">
      <div className="pb-4">
        <div className="text-[12.5px] font-semibold text-muted">{label}</div>
        <div className="text-[11px] text-subtle tabular-nums">{sum} total</div>
      </div>
      <div>
        <div className="grid gap-[2px] h-[56px] items-end border-b border-line" style={{ gridTemplateColumns: `repeat(${weeks.length}, 1fr)` }}>
          {weeks.map((w) => (
            <div key={w.start.toISOString()} className="h-full flex items-end group" title={`Week of ${shortDate(w.start)}: ${w[k]}`}>
              <div
                className="w-full bg-brand rounded-t-[4px] group-hover:bg-brand-hover"
                style={{ height: w[k] ? `${Math.max((w[k] / max) * 100, 6)}%` : 0 }}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-between text-[10.5px] text-faint mt-1 tabular-nums">
          <span>{shortDate(weeks[0].start)}</span>
          <span>This week</span>
        </div>
      </div>
    </div>
  );
}

function ApplicationsTable({ rows }: { rows: JobTimeline[] }) {
  const now = new Date();
  const days = (a: Date | null, b: Date | null) => (a && b ? fmtDays(Math.max(0, (b.getTime() - a.getTime()) / 86_400_000)) : "–");
  return (
    <div className="overflow-x-auto -mx-5">
      <table className="w-full text-[12.5px] border-collapse">
        <thead>
          <tr className="text-left text-[11px] font-bold text-faint uppercase tracking-[.06em]">
            <th className="px-5 pb-2 font-bold">Job</th>
            <th className="px-3 pb-2 font-bold">Status</th>
            <th className="px-3 pb-2 font-bold">Applied</th>
            <th className="px-3 pb-2 font-bold text-right" title="Days from adding the job to applying">To apply</th>
            <th className="px-3 pb-2 font-bold text-right" title="Days from applying to the first interview">To interview</th>
            <th className="px-5 pb-2 font-bold text-right" title="Days from applying to a rejection or offer, or how long you've been waiting">
              To outcome
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const outcome = t.offerAt ?? t.rejectedAt;
            const waiting = t.status === "applied" || t.status === "interviewing";
            return (
              <tr key={t.id} className="border-t border-line hover:bg-panel">
                <td className="px-5 py-2 max-w-[360px]">
                  <Link href={`/j/${t.id}`} className="block truncate font-semibold text-ink hover:text-brand">
                    {t.title || "Untitled job"}
                  </Link>
                  <span className="block truncate text-[11.5px] text-subtle">
                    {t.company || companyFromUrl(t.url)}
                    {t.source !== "app" && " · suggested"}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <StatusPill status={t.status} />
                </td>
                <td className="px-3 py-2 text-muted tabular-nums whitespace-nowrap">{shortDate(t.appliedAt!)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted">{days(t.addedAt, t.appliedAt)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted">{days(t.appliedAt, t.interviewAt)}</td>
                <td className="px-5 py-2 text-right tabular-nums whitespace-nowrap">
                  {outcome ? (
                    <span className="text-ink font-semibold">{days(t.appliedAt, outcome)}</span>
                  ) : waiting ? (
                    <span className="text-faint" title="No outcome yet">
                      {days(t.appliedAt, now)} so far
                    </span>
                  ) : (
                    <span className="text-faint">–</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
