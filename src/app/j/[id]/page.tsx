import { notFound } from "next/navigation";
import { Workspace } from "@/components/workspace";
import { requireUser } from "@/lib/auth";
import { getBaseResume, getJob } from "@/lib/data";

export default async function JobPage({ params }: PageProps<"/j/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const [job, base] = await Promise.all([getJob(user.id, id), getBaseResume(user.id)]);
  if (!job) notFound();

  return <Workspace key={job.id} user={{ name: user.name, email: user.email }} base={base} history={[]} job={job} />;
}
