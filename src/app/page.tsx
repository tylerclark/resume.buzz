import { Workspace } from "@/components/workspace";
import { requireUser } from "@/lib/auth";
import { getBaseResume, listJobs } from "@/lib/data";

export default async function Home({ searchParams }: PageProps<"/">) {
  const user = await requireUser();
  const { url } = await searchParams;
  const [base, history] = await Promise.all([getBaseResume(user.id), listJobs(user.id)]);

  return (
    <Workspace
      user={{ name: user.name, email: user.email }}
      base={base}
      history={history}
      job={null}
      autoUrl={typeof url === "string" ? url : undefined}
    />
  );
}
