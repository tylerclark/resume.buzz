import { notFound } from "next/navigation";
import { Workspace } from "@/components/workspace";
import { requireUser } from "@/lib/auth";
import { getBaseResume, getFacts, getJob, listJobs } from "@/lib/data";

export default async function JobPage({ params }: PageProps<"/j/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const [job, base, history, facts] = await Promise.all([
    getJob(user.id, id),
    getBaseResume(user.id),
    listJobs(user.id, 50),
    getFacts(user.id),
  ]);
  if (!job) notFound();

  return (
    <Workspace
      key={job.id}
      user={{ name: user.name, email: user.email }}
      base={base}
      facts={facts}
      history={history}
      job={job}
    />
  );
}
