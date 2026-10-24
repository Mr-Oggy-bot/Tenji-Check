"use client";

import { ChevronRight, LogOut } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Spinner } from "@/components/ui";
import { ROLE_LABEL, useAuth } from "@/lib/auth";
import { servicesFor } from "@/lib/services";

export default function AccountPage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!loading && !user) router.replace("/login?next=/account");
  }, [loading, user, router]);
  if (loading || !user) return <Spinner />;

  const links = servicesFor(user.role).slice(0, 6);
  const initials = user.display_name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-2xl font-bold text-slate-900">Account</h1>
      <section className="flex items-center gap-4 rounded-3xl bg-gov-600 p-5 text-white shadow-soft">
        <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-white text-xl font-bold text-gov-700" aria-hidden>{initials}</span>
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold">{user.display_name}</p>
          <p className="truncate text-sm text-gov-100">{user.email}</p>
          <p className="mt-1 inline-block rounded-full bg-white/15 px-2.5 py-0.5 text-xs">{ROLE_LABEL[user.role]}</p>
        </div>
      </section>
      <section className="overflow-hidden rounded-3xl bg-white shadow-soft" aria-label="Your services">
        <ul className="divide-y divide-slate-100">
          {links.map((s) => (
            <li key={s.href}>
              <Link href={s.href} className="press flex min-h-[56px] items-center gap-3 px-5 text-sm font-medium text-slate-800 hover:bg-gov-50">
                <s.icon className="h-5 w-5 text-gov-600" aria-hidden /> <span className="flex-1">{s.label}</span>
                <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <button onClick={() => { logout(); router.push("/"); }}
        className="press flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-white text-sm font-semibold text-red-700 shadow-soft hover:bg-red-50">
        <LogOut className="h-4 w-4" aria-hidden /> Sign out
      </button>
    </div>
  );
}
