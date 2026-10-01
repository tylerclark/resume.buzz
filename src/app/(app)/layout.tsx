import { AppHeader } from "@/components/app-header";
import { JobStatusProvider } from "@/components/job-status";
import { TabsProvider } from "@/components/tabs-store";
import { requireUser } from "@/lib/auth";

// Everything behind sign-in shares the header + tab bar, so tabs (and the status poller behind them)
// survive navigating between jobs.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <TabsProvider userId={user.id}>
      <JobStatusProvider>
        <div className="h-screen flex flex-col overflow-hidden">
          <AppHeader user={{ name: user.name, email: user.email }} demo={user.demo} />
          {children}
        </div>
      </JobStatusProvider>
    </TabsProvider>
  );
}
