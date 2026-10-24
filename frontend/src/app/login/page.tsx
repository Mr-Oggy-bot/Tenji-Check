"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button, Card, Field, inputCls, Notice } from "@/components/ui";
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
    <div className="mx-auto max-w-md space-y-4">
      <Card title={mode === "login" ? "Sign in" : "Create a citizen account"}>
        <form onSubmit={submit} className="space-y-4" noValidate>
          {mode === "register" && (
            <Field label="Your name" required>
              {(id) => <input id={id} className={inputCls} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />}
            </Field>
          )}
          <Field label="Email" required>
            {(id) => <input id={id} type="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />}
          </Field>
          <Field label="Password" required hint={mode === "register" ? "At least 8 characters" : undefined}>
            {(id) => (
              <input id={id} type="password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "login" ? "current-password" : "new-password"} required />
            )}
          </Field>
          {error && <Notice tone="red">{error}</Notice>}
          <Button type="submit" loading={busy} className="w-full">{mode === "login" ? "Sign in" : "Create account"}</Button>
          <button type="button" className="w-full text-sm text-teal-700 underline" onClick={() => setMode(mode === "login" ? "register" : "login")}>
            {mode === "login" ? "New here? Create a citizen account" : "Already have an account? Sign in"}
          </button>
          <p className="text-xs text-slate-500">Staff accounts (inspector, engineer, contractor) are created by an administrator. You can also report an issue without an account.</p>
        </form>
      </Card>
      <Card title="Demo accounts">
        <p className="mb-3 text-sm text-slate-600">
          Local demo only. Password for all: <code className="rounded bg-slate-100 px-1">tenjicheck-demo</code>
        </p>
        <div className="grid grid-cols-2 gap-2">
          {DEMO.map(([role, label]) => (
            <Button key={role} variant="secondary" disabled={busy}
              onClick={(e) => submit(e as unknown as React.FormEvent, [`${role}@tenjicheck.local`, "tenjicheck-demo"])}>
              {label}
            </Button>
          ))}
        </div>
      </Card>
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
