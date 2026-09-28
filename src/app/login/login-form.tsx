"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";

const input =
  "w-full box-border border border-line-2 rounded-[10px] text-[14px] px-3 py-[11px] bg-white text-ink disabled:opacity-60";
const primary =
  "bg-brand hover:bg-brand-hover text-white border-0 rounded-[10px] px-4 h-[42px] text-[14px] font-bold cursor-pointer disabled:opacity-60 disabled:cursor-default";

export function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await authClient.emailOtp.sendVerificationOtp({ email: email.trim(), type: "sign-in" });
    setBusy(false);
    if (error) return setError(error.message ?? "Couldn't send the code.");
    setSent(true);
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await authClient.signIn.emailOtp({ email: email.trim(), otp: otp.trim() });
    if (error) {
      setBusy(false);
      return setError(error.message ?? "That code didn't work.");
    }
    window.location.assign(next);
  }

  if (!sent) {
    return (
      <form onSubmit={sendCode} className="flex flex-col gap-2">
        <label className="eyebrow" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          autoFocus
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
          placeholder="you@example.com"
          className={input}
        />
        <button type="submit" disabled={busy} className={primary}>
          {busy ? "Sending…" : "Email me a code →"}
        </button>
        {error && <p className="m-0 text-[12.5px] text-bad">{error}</p>}
      </form>
    );
  }

  return (
    <form onSubmit={verify} className="flex flex-col gap-2">
      <label className="eyebrow" htmlFor="otp">
        Code sent to {email}
      </label>
      <input
        id="otp"
        inputMode="numeric"
        autoComplete="one-time-code"
        data-1p-ignore
        autoFocus
        required
        maxLength={6}
        value={otp}
        onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
        disabled={busy}
        placeholder="123456"
        className={`${input} text-center text-[22px] font-extrabold tracking-[.3em]`}
      />
      <button type="submit" disabled={busy || otp.length < 6} className={primary}>
        {busy ? "Checking…" : "Sign in"}
      </button>
      {error && <p className="m-0 text-[12.5px] text-bad">{error}</p>}
      <div className="flex justify-between text-[12.5px] mt-1">
        <button
          type="button"
          onClick={() => {
            setSent(false);
            setOtp("");
            setError(null);
          }}
          className="bg-transparent border-0 p-0 text-subtle font-semibold cursor-pointer"
        >
          ← Different email
        </button>
        <button
          type="button"
          onClick={() => sendCode()}
          disabled={busy}
          className="bg-transparent border-0 p-0 text-brand font-semibold cursor-pointer"
        >
          Resend code
        </button>
      </div>
    </form>
  );
}
