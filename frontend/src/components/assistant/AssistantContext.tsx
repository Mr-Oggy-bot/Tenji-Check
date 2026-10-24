"use client";

// Lightweight entry point for "Ask TenjiCheck". The CopilotKit runtime (AssistantRuntime) is loaded only the first
// time the user opens the assistant, so pages that never use it are unaffected.
import { Sparkles, X } from "lucide-react";
import dynamic from "next/dynamic";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { getToken } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const AssistantRuntime = dynamic(() => import("./AssistantRuntime"), { ssr: false });
const ROLES = ["admin", "inspector", "engineer", "contractor"];

type Status = { configured: boolean; reachable: boolean; reason: string; model: string; provider: string };
interface Ctx { allowed: boolean; open: boolean; toggle: () => void }
const AssistantCtx = createContext<Ctx>({ allowed: false, open: false, toggle: () => {} });
export const useAssistant = () => useContext(AssistantCtx);

export function AssistantProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const allowed = !!user && ROLES.includes(user.role);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [failed, setFailed] = useState("");

  const toggle = useCallback(() => {
    setOpen((o) => !o);
    if (status) return;
    fetch("/api/assistant-status", { headers: { Authorization: `Bearer ${getToken() ?? ""}` }, cache: "no-store" })
      .then(async (r) => (r.ok ? setStatus(await r.json()) : setFailed("The assistant is not available for this account.")))
      .catch(() => setFailed("Could not reach the assistant."));
  }, [status]);

  const value = useMemo(() => ({ allowed, open, toggle }), [allowed, open, toggle]);
  return (
    <AssistantCtx.Provider value={value}>
      {children}
      {allowed && status?.configured && status.reachable && <AssistantRuntime open={open} onOpenChange={setOpen} role={user!.role} />}
      {allowed && open && !(status?.configured && status.reachable) && (
        <div role="dialog" aria-label="Ask TenjiCheck" className="fixed bottom-4 right-4 z-[1600] w-[min(380px,calc(100vw-2rem))] rounded-3xl bg-gov-700 p-5 font-display text-white shadow-soft">
          <div className="flex items-start justify-between gap-3">
            <p className="flex items-center gap-2 text-lg"><Sparkles className="h-5 w-5 text-gov-300" aria-hidden /> Ask TenjiCheck</p>
            <button onClick={() => setOpen(false)} className="grid h-9 w-9 place-items-center rounded-full bg-white/10 hover:bg-white/20" aria-label="Close assistant">
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-3 text-sm text-slate-200">
            {failed || (!status ? "Checking the assistant…" : status.configured ? status.reason : "The assistant is off. An administrator can turn it on by setting TC_GITHUB_MODELS_TOKEN (a GitHub token with models:read) in backend/.env and restarting the web server.")}
          </p>
        </div>
      )}
    </AssistantCtx.Provider>
  );
}
