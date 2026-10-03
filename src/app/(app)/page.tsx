import { Workspace } from "@/components/workspace";
import { requireUser } from "@/lib/auth";
import { getBaseResume, getFacts, listJobs } from "@/lib/data";

export default async function Home({ searchParams }: PageProps<"/">) {
  const user = await requireUser();
  const { url } = await searchParams;
  const [base, history, facts] = await Promise.all([getBaseResume(user.id), listJobs(user.id), getFacts(user.id)]);

  return (
    <Workspace
      base={base}
      facts={facts}
      history={history}
      job={null}
      autoUrl={typeof url === "string" ? url : undefined}
    />
  );
}
