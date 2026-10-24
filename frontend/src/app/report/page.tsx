"use client";

import { Camera, CheckCircle2, LocateFixed, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { MapView } from "@/components/MapView";
import { useToast } from "@/components/toast";
import { Button, Card, Field, inputCls, LinkButton, Notice, PageHeader } from "@/components/ui";
import { api, ApiError, idemKey } from "@/lib/api";
import { DEFAULT_CENTER, getPosition } from "@/lib/geo";
import { sendOrQueue } from "@/lib/offline";

interface Cat { value: string; label: string }

export default function ReportPage() {
  const toast = useToast();
  const [cats, setCats] = useState<Cat[]>([]);
  const [category, setCategory] = useState("blocked_tactile_path");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [desc, setDesc] = useState("");
  const [contact, setContact] = useState("");
  const [pin, setPin] = useState<[number, number] | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [noLocation, setNoLocation] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [locMsg, setLocMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ reference?: string; queued?: boolean } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => { api<Cat[]>("/issues/categories").then(setCats).catch(() => {}); }, []);
  useEffect(() => {
    if (!file) return setPreview(null);
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  async function locate() {
    setLocMsg("");
    try {
      const f = await getPosition();
      setPin([f.lat, f.lon]);
      setAccuracy(f.accuracy);
      setConfirmed(false);
      setNoLocation(false);
    } catch (e) {
      setLocMsg((e as Error).message);
    }
  }

  async function submit() {
    const errs: Record<string, string> = {};
    if (!file) errs.file = "A photo is required";
    if (!noLocation && !pin) errs.loc = "Add a location (GPS or tap the map), or choose photo-only";
    if (pin && !noLocation && !confirmed) errs.loc = "Confirm that the pin marks the right place";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    const fields: Record<string, string> = { category, description: desc, reporter_contact: contact };
    if (pin && !noLocation) {
      Object.assign(fields, { lat: String(pin[0]), lon: String(pin[1]), location_confirmed: "true" });
      if (accuracy != null) fields.gps_accuracy_m = String(accuracy);
    }
    try {
      const r = await sendOrQueue<{ reference: string }>({ id: idemKey(), path: "/issues", label: "Accessibility report", fields, file: file!, fileName: file!.name || "photo.jpg", createdAt: Date.now() });
      setDone(r ? { reference: r.reference } : { queued: true });
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) toast.error(e.message);
      else toast.error(e);
    } finally { setBusy(false); }
  }

  if (done) {
    return (
      <div className="mx-auto max-w-md pt-4">
        <section className="rounded-[2rem] bg-white px-6 py-10 text-center shadow-soft">
          <CheckCircle2 className="mx-auto h-14 w-14 text-gov-600" aria-hidden />
          {done.reference ? (
            <>
              <h1 className="mt-4 text-3xl font-extrabold tracking-wide text-slate-900">THANK YOU</h1>
              <p className="mx-auto mt-3 max-w-xs text-slate-500">Your report has been sent to the inspection team. You can check its status with this reference.</p>
              <p className="mt-6 text-xs font-semibold uppercase tracking-wider text-gov-600">Report received</p>
              <p className="mt-1 select-all rounded-2xl bg-gov-50 py-3 font-mono text-2xl font-bold tracking-wider text-gov-800" aria-live="polite">{done.reference}</p>
              <div className="mt-8 grid gap-2">
                <LinkButton href="/" className="min-h-[50px] rounded-2xl text-base">Back to Home</LinkButton>
                <LinkButton href={`/report/status?ref=${done.reference}`} variant="secondary" className="rounded-2xl">Check status</LinkButton>
                <button className="mt-1 text-sm font-semibold text-gov-600 hover:underline" onClick={() => { setDone(null); setFile(null); setDesc(""); setConfirmed(false); }}>Report another issue</button>
              </div>
            </>
          ) : (
            <>
              <h1 className="mt-4 text-2xl font-bold text-slate-900">Saved offline</h1>
              <p className="mt-2 text-sm text-slate-500">The report will be sent automatically when you are back online. You will get a reference number then.</p>
              <LinkButton href="/" className="mt-6 w-full rounded-2xl">Back to Home</LinkButton>
            </>
          )}
        </section>
      </div>
    );
  }

  return (
    <>
      <PageHeader title="Report an issue" subtitle="Blocked, broken or missing tactile paving" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="1 · Details">
          <div className="space-y-4">
            <Field label="Issue type" required>{(id) => (
              <select id={id} className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)}>
                {cats.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>)}</Field>
            <Field label="Photo" required error={errors.file}>{(id) => (
              <label htmlFor={id} className="press flex min-h-[140px] cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-gov-200 bg-gov-50/50 p-3 text-sm font-medium text-gov-700 hover:border-gov-500">
                {preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={preview} alt="Selected photo" className="max-h-64 rounded object-contain" />
                ) : (<><Camera className="h-8 w-8 text-gov-500" aria-hidden /><span>Upload images</span></>)}
                <input id={id} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] || null)} />
              </label>)}</Field>
            <Field label="Description (optional)">{(id) => <textarea id={id} className={inputCls} rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={2000} placeholder="e.g. Scooters parked across the yellow strip every evening" />}</Field>
            <Field label="Contact (optional)" hint="Only visible to staff, never shown publicly.">{(id) => <input id={id} className={inputCls} value={contact} onChange={(e) => setContact(e.target.value)} maxLength={200} />}</Field>
          </div>
        </Card>
        <Card title="2 · Location">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={locate}><LocateFixed className="h-4 w-4" /> Use my location</Button>
              <label className="flex min-h-[44px] items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4" checked={noLocation} onChange={(e) => setNoLocation(e.target.checked)} /> Photo-only (no location)
              </label>
            </div>
            {locMsg && <Notice>{locMsg}</Notice>}
            {!noLocation && (
              <>
                <MapView center={pin || DEFAULT_CENTER} zoom={pin ? 18 : 15} height={300} fit={pin ? [pin] : undefined} fitKey={pin ? pin.join() : ""}
                  onMapClick={(lat, lon) => { setPin([lat, lon]); setConfirmed(false); setAccuracy(null); }}
                  markers={pin ? [{ id: "pin", lat: pin[0], lon: pin[1], color: "#dc2626", draggable: true, label: "Drag to adjust", onDragEnd: (lat, lon) => { setPin([lat, lon]); setConfirmed(false); } }] : []} />
                <p className="text-xs text-slate-500">Tap the map to drop a pin, or drag it to the exact spot.{accuracy ? ` GPS accuracy ±${Math.round(accuracy)} m.` : ""}</p>
                {pin && (
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input type="checkbox" className="h-4 w-4" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> The pin marks where the problem is
                  </label>
                )}
              </>
            )}
            {errors.loc && <p className="text-sm font-medium text-red-700" role="alert">{errors.loc}</p>}
            <p className="flex items-center gap-1.5 text-xs text-slate-500"><ShieldCheck className="h-4 w-4 shrink-0 text-gov-600" aria-hidden /> Photos are private; faces and number plates are blurred.</p>
            <Button onClick={submit} loading={busy} className="min-h-[50px] w-full rounded-2xl text-base">Submit report</Button>
            <p className="text-center text-xs text-slate-500">Already reported? <Link className="font-semibold text-gov-600 hover:underline" href="/report/status">Track a report</Link></p>
          </div>
        </Card>
      </div>
    </>
  );
}
