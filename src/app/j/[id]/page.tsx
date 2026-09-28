import { notFound } from "next/navigation";
import { Workspace } from "@/components/workspace";
import { requireUser } from "@/lib/auth";
import { getBaseResume, getJob, listJobs } from "@/lib/data";

export default async function JobPage({ params }: PageProps<"/j/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const [job, base, history] = await Promise.all([getJob(user.id, id), getBaseResume(user.id), listJobs(user.id, 50)]);
  if (!job) notFound();

  return (
    <Workspace key={job.id} user={{ name: user.name, email: user.email }} base={base} history={history} job={job} />
  );
}
