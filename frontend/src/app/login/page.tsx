"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button, Field, Notice } from "@/components/ui";

const pill = "block w-full min-h-[50px] rounded-2xl border-0 bg-slate-100 px-5 text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-gov-500";
import { useAuth } from "@/lib/auth";

const DEMO = [
  ["inspector", "Inspector / reviewer"],
  ["engineer", "Site engineer"],
  ["contractor", "Contractor"],
  ["citizen", "Citizen"],
  ["admin", "Administrator"],
];

function LoginForm() {
  const { login, register } = useAuth();
  const router = useRouter();
  const next = useSearchParams().get("next") || "/";
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent, override?: [string, string]) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "register" && !override) await register(email, name, password);
      else await login(override?.[0] ?? email, override?.[1] ?? password);
      router.replace(next.startsWith("/") ? next : "/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-5 pt-2 sm:pt-6">
      <section className="rounded-[2rem] bg-white px-6 py-8 shadow-soft sm:px-8">
        <h1 className="text-center text-3xl font-bold text-slate-900">{mode === "login" ? "Welcome" : "Create account"}</h1>
        <p className="mt-1 text-center text-sm text-slate-500">{mode === "login" ? "Sign in to TenjiCheck" : "Citizen account"}</p>
        <form onSubmit={submit} className="mt-7 space-y-4" noValidate>
          {mode === "register" && (
            <Field label="Your name" required>
              {(id) => <input id={id} className={pill} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />}
            </Field>
          )}
          <Field label="Email" required>
            {(id) => <input id={id} type="email" className={pill} placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />}
          </Field>
          <Field label="Password" required hint={mode === "register" ? "At least 8 characters" : undefined}>
            {(id) => (
              <input id={id} type="password" className={pill} value={password} onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "login" ? "current-password" : "new-password"} required />
            )}
          </Field>
          {error && <Notice tone="red">{error}</Notice>}
          <Button type="submit" loading={busy} className="min-h-[50px] w-full rounded-2xl text-base">{mode === "login" ? "Sign in" : "Create account"}</Button>
        </form>
        <div className="mt-6 border-t border-slate-200 pt-4 text-center">
          <button type="button" className="text-sm font-semibold text-gov-600 hover:underline" onClick={() => setMode(mode === "login" ? "register" : "login")}>
            {mode === "login" ? "Don't have an account? Sign up here" : "Already have an account? Sign in"}
          </button>
        </div>
      </section>
      <section className="rounded-[2rem] bg-white px-6 py-5 shadow-soft sm:px-8" aria-labelledby="demo-title">
        <h2 id="demo-title" className="text-sm font-semibold text-slate-900">Demo accounts</h2>
        <p className="mb-3 text-xs text-slate-500">Password: <code className="rounded bg-slate-100 px-1">tenjicheck-demo</code></p>
        <div className="grid grid-cols-2 gap-2">
          {DEMO.map(([role, label]) => (
            <Button key={role} variant="secondary" disabled={busy} className="rounded-2xl"
              onClick={(e) => submit(e as unknown as React.FormEvent, [`${role}@tenjicheck.local`, "tenjicheck-demo"])}>
              {label}
            </Button>
          ))}
        </div>
      </section>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
