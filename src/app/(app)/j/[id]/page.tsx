import { notFound } from "next/navigation";
import { Workspace } from "@/components/workspace";
import { requireUser } from "@/lib/auth";
import { getBaseResume, getCoverStarters, getFacts, getJob, listJobs } from "@/lib/data";

export default async function JobPage({ params }: PageProps<"/j/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const [job, base, history, facts, coverStarters] = await Promise.all([
    getJob(user.id, id),
    getBaseResume(user.id),
    listJobs(user.id, 50),
    getFacts(user.id),
    getCoverStarters(user.id),
  ]);
  if (!job) notFound();

  return (
    <Workspace
      key={job.id}
      base={base}
      facts={facts}
      coverStarters={coverStarters}
      history={history}
      job={job}
    />
  );
}
