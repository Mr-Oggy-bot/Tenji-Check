"use client";

import { useRequireRole } from "@/lib/auth";
import type { Role, User } from "@/lib/types";
import { Notice, Spinner } from "./ui";

export function RoleGate({ roles, children }: { roles?: Role[]; children: (user: User) => React.ReactNode }) {
  const { user, loading, allowed } = useRequireRole(roles);
  if (loading || !user) return <Spinner />;
  if (!allowed) return <Notice tone="red" title="Not available for your role">This page is limited to: {roles?.join(", ")}.</Notice>;
  return <>{children(user)}</>;
}
