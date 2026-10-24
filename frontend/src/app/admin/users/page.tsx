"use client";

import { Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { RoleGate } from "@/components/RoleGate";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, Field, inputCls, Modal, PageHeader, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { ROLE_LABEL } from "@/lib/auth";
import type { Role, User } from "@/lib/types";

const ROLES = Object.keys(ROLE_LABEL) as Role[];

export default function UsersPage() {
  return <RoleGate roles={["admin"]}>{(me) => <Users me={me} />}</RoleGate>;
}

function Users({ me }: { me: User }) {
  const toast = useToast();
  const [rows, setRows] = useState<User[] | null>(null);
  const [open, setOpen] = useState(false);
  const load = useCallback(() => api<User[]>("/admin/users").then(setRows).catch((e) => toast.error(e)), // eslint-disable-next-line react-hooks/exhaustive-deps
    []);
  useEffect(() => { load(); }, [load]);

  async function patch(u: User, body: Partial<User>) {
    try { await api(`/users/${u.id}`, { method: "PATCH", body }); toast.success("User updated"); load(); } catch (e) { toast.error(e); }
  }

  if (!rows) return <Spinner />;
  return (
    <>
      <PageHeader eyebrow="Admin" title="Users & roles" subtitle="Roles are enforced on the server for every action." actions={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Add user</Button>} />
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
            <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-2">Name</th><th>Email</th><th>Role</th><th>Status</th></tr></thead>
            <tbody>{rows.map((u) => (
              <tr key={u.id} className="border-t">
                <td className="py-2 font-medium">{u.display_name}{u.id === me.id && <Badge tone="slate" className="ml-2">You</Badge>}</td>
                <td>{u.email}</td>
                <td><select aria-label={`Role for ${u.display_name}`} className={`${inputCls} w-48`} value={u.role} disabled={u.id === me.id} onChange={(e) => patch(u, { role: e.target.value as Role })}>
                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></td>
                <td><Button variant="secondary" disabled={u.id === me.id} onClick={() => patch(u, { is_active: !u.is_active })}>{u.is_active ? "Disable" : "Enable"}</Button></td>
              </tr>))}</tbody>
          </table>
        </div>
      </Card>
      <NewUser open={open} onClose={() => setOpen(false)} onDone={() => { setOpen(false); load(); }} />
    </>
  );
}

function NewUser({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ email: "", display_name: "", password: "", role: "inspector" });
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try { await api("/users", { body: f }); toast.success("User created"); setF({ email: "", display_name: "", password: "", role: "inspector" }); onDone(); }
    catch (e) { toast.error(e); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title="Add user" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Create</Button></>}>
      <Field label="Name" required>{(id) => <input id={id} className={inputCls} value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} />}</Field>
      <Field label="Email" required>{(id) => <input id={id} type="email" className={inputCls} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
      <Field label="Temporary password" required hint="At least 8 characters">{(id) => <input id={id} type="password" className={inputCls} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />}</Field>
      <Field label="Role">{(id) => <select id={id} className={inputCls} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>}</Field>
    </Modal>
  );
}
