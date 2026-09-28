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
      <div className="w-full max-w-[380px] flex flex-col gap-6">
        <div className="flex justify-center">
          <Logo variant="stacked" height={190} priority />
        </div>
        <div className="bg-white border border-line-2 rounded-[14px] p-6 flex flex-col gap-4">
          <div>
            <h1 className="m-0 text-[20px] font-extrabold tracking-[-.02em]">Sign in</h1>
            <p className="m-0 mt-1 text-[13px] text-muted">We&apos;ll email you a 6-digit code. No password.</p>
          </div>
          <LoginForm next={dest} />
        </div>
      </div>
    </main>
  );
}
