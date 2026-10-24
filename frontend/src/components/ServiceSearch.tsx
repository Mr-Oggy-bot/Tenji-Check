"use client";

// Search box that finds a service by name or keyword and opens it (arrow keys + Enter, or click).
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useMemo, useRef, useState } from "react";
import { servicesFor, type Viewer } from "@/lib/services";

export function ServiceSearch({ viewer, className = "", large = false }: { viewer: Viewer; className?: string; large?: boolean }) {
  const router = useRouter();
  const id = useId();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const all = useMemo(() => servicesFor(viewer), [viewer]);
  const term = q.trim().toLowerCase();
  const hits = term ? all.filter((s) => `${s.label} ${s.keywords ?? ""}`.toLowerCase().includes(term)) : all;

  function go(href: string) {
    setOpen(false);
    setQ("");
    router.push(href);
  }

  return (
    <div ref={box} className={`relative ${className}`} onBlur={(e) => !box.current?.contains(e.relatedTarget as Node) && setOpen(false)}>
      <label htmlFor={id} className="sr-only">Search services</label>
      <input
        id={id} role="combobox" aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list"
        aria-activedescendant={open && hits[active] ? `${id}-${active}` : undefined}
        value={q} placeholder="Search services"
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQ(e.target.value); setActive(0); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, hits.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === "Enter" && hits[active]) { e.preventDefault(); go(hits[active].href); }
          else if (e.key === "Escape") setOpen(false);
        }}
        className={`block w-full rounded-full border border-slate-200 bg-white pl-5 pr-11 text-sm text-slate-900 shadow-soft placeholder:text-slate-400 focus:border-gov-500 focus:outline-none focus:ring-2 focus:ring-gov-500/25 ${large ? "min-h-[52px]" : "min-h-[42px]"}`}
      />
      <Search className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-700" aria-hidden />
      {open && (
        <ul id={`${id}-list`} role="listbox" aria-label="Services"
          className="absolute inset-x-0 top-full z-50 mt-2 max-h-80 overflow-auto rounded-2xl border border-slate-100 bg-white p-1.5 shadow-xl">
          {hits.length ? hits.map((s, i) => (
            <li key={s.href} id={`${id}-${i}`} role="option" aria-selected={i === active}>
              <button type="button" tabIndex={-1} onMouseEnter={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => go(s.href)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm ${i === active ? "bg-gov-50 text-gov-800" : "text-slate-700"}`}>
                <s.icon className="h-4 w-4 text-gov-600" aria-hidden /> {s.label}
              </button>
            </li>
          )) : <li className="px-3 py-3 text-sm text-slate-500">No service matches &ldquo;{q}&rdquo;</li>}
        </ul>
      )}
    </div>
  );
}
