"use client";
import { useCallback, useEffect, useState } from "react";
import { KeyRound, Plus } from "lucide-react";
import { api, type User } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";
import { Avatar, Badge, Button, Card, Dialog, Field, Input, PageHeader, Select, Skeleton } from "@/components/ui";

export default function TeachersPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState<User[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);

  const load = useCallback(() => api<User[]>("/api/users").then(setRows).catch((e) => toast(e.message, "err")), [toast]);
  useEffect(() => { load(); }, [load]);

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    setBusy(true);
    try {
      await api("/api/users", { body: { ...f, email: f.email.trim().toLowerCase() } });
      toast(`Account created for ${f.email}`); setOpen(false); load();
    } catch (err) { toast((err as Error).message, "err"); }
    finally { setBusy(false); }
  }

  async function changePw(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const pw = String(f.get("new_password"));
    if (pw !== String(f.get("confirm_password"))) { toast("The two passwords don't match", "err"); return; }
    setPwBusy(true);
    try {
      const { error } = await supabase().auth.updateUser({ password: pw });
      if (error) throw error;
      toast("Password changed"); form.reset();
    } catch (err) { toast((err as Error).message, "err"); }
    finally { setPwBusy(false); }
  }

  return (
    <>
      <PageHeader eyebrow="Admin" title="Staff" subtitle="Teachers take attendance for their own subjects. Admins manage students, subjects and can correct saved attendance."
        actions={<Button variant="primary" onClick={() => setOpen(true)}><Plus className="size-4" /> Add account</Button>} />

      <div className="grid items-start gap-6 lg:grid-cols-[1.4fr_1fr]">
        {rows === null ? <Skeleton className="h-64" /> : (
          <Card className="divide-y divide-line">
            {rows.map((u) => (
              <div key={u.id} className="flex items-center gap-3 px-5 py-3.5">
                <Avatar name={u.full_name} seed={u.email} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{u.full_name}{u.id === user?.id && <span className="text-muted"> (you)</span>}</div>
                  <div className="truncate text-xs text-muted">{u.email}</div>
                </div>
                <Badge tone={u.role === "admin" ? "brand" : "muted"} className="capitalize">{u.role}</Badge>
              </div>
            ))}
          </Card>
        )}

        <Card className="p-5">
          <div className="mb-4 flex items-center gap-2"><KeyRound className="size-4 text-brand" /><h2 className="font-semibold">Change my password</h2></div>
          <form onSubmit={changePw} className="flex flex-col gap-3">
            <Field label="New password" hint="At least 8 characters"><Input name="new_password" type="password" required minLength={8} autoComplete="new-password" /></Field>
            <Field label="Confirm new password"><Input name="confirm_password" type="password" required minLength={8} autoComplete="new-password" /></Field>
            <Button loading={pwBusy} className="mt-1 self-start">Update password</Button>
          </form>
        </Card>
      </div>

      <Dialog open={open} onClose={() => setOpen(false)} title="Add account" description="They sign in with this email and the temporary password, then change it under Staff.">
        <form onSubmit={create} className="flex flex-col gap-4">
          <Field label="Full name"><Input name="full_name" required placeholder="Prof. Neha Arora" /></Field>
          <Field label="Email"><Input name="email" type="email" required autoComplete="off" placeholder="teacher@college.edu" /></Field>
          <Field label="Temporary password" hint="At least 8 characters">
            <Input name="password" type="password" required minLength={8} maxLength={72} autoComplete="new-password" />
          </Field>
          <Field label="Role"><Select name="role" defaultValue="teacher"><option value="teacher">Teacher</option><option value="admin">Admin</option></Select></Field>
          <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={busy}>Create account</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
