"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GraduationCap, ImagePlus, Plus, Search, Trash2, UploadCloud, X } from "lucide-react";
import { api, type Student } from "@/lib/api";
import { useToast } from "@/components/toast";
import { Avatar, Badge, Button, Card, Confirm, Dialog, Empty, Field, Input, PageHeader, Select, Skeleton } from "@/components/ui";

export default function StudentsPage() {
  const toast = useToast();
  const [rows, setRows] = useState<Student[] | null>(null);
  const [q, setQ] = useState("");
  const [section, setSection] = useState("");
  const [enrolOpen, setEnrolOpen] = useState(false);
  const [del, setDel] = useState<Student | null>(null);
  const [deleting, setDeleting] = useState(false);
  const addRef = useRef<HTMLInputElement>(null);
  const [addFor, setAddFor] = useState<string | null>(null);

  const load = useCallback(() => api<Student[]>("/api/students").then(setRows).catch((e) => toast(e.message, "err")), [toast]);
  useEffect(() => { load(); }, [load]);

  const sections = useMemo(() => [...new Set(rows?.map((r) => r.section))].sort(), [rows]);
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (rows ?? []).filter((r) => (!section || r.section === section) && (!n || r.name.toLowerCase().includes(n) || r.roll_no.toLowerCase().includes(n)));
  }, [rows, q, section]);

  async function remove() {
    if (!del) return;
    setDeleting(true);
    try { await api(`/api/students/${encodeURIComponent(del.roll_no)}`, { method: "DELETE" }); toast(`${del.name} removed`); setDel(null); load(); }
    catch (e) { toast((e as Error).message, "err"); }
    finally { setDeleting(false); }
  }

  async function addPhotos(files: FileList | null) {
    if (!files?.length || !addFor) return;
    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append("photos", f));
    try { await api(`/api/students/${encodeURIComponent(addFor)}/photos`, { body: fd }); toast("Photo added"); load(); }
    catch (e) { toast((e as Error).message, "err"); }
    finally { setAddFor(null); if (addRef.current) addRef.current.value = ""; }
  }

  return (
    <>
      <PageHeader eyebrow="Admin" title="Students"
        subtitle="Each student is matched by their admission photo. One clear, front-facing face per photo — 2–3 photos improve accuracy."
        actions={<Button variant="primary" onClick={() => setEnrolOpen(true)}><Plus className="size-4" /> Enrol student</Button>} />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input placeholder="Search name or roll no" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        </div>
        <Select value={section} onChange={(e) => setSection(e.target.value)} className="sm:w-48" aria-label="Section">
          <option value="">All sections</option>
          {sections.map((s) => <option key={s}>{s}</option>)}
        </Select>
      </div>

      {rows === null ? <Skeleton className="h-96" /> : rows.length === 0 ? (
        <Empty icon={<GraduationCap className="size-5" />} title="No students yet" action={<Button variant="primary" onClick={() => setEnrolOpen(true)}><Plus className="size-4" /> Enrol the first student</Button>}>
          Enrol students with their admission photo so the camera can recognise them.
        </Empty>
      ) : (
        <Card className="overflow-hidden">
          <div className="hidden grid-cols-[1fr_140px_120px_96px] gap-4 border-b border-line px-5 py-2.5 text-xs font-medium uppercase tracking-wide text-muted md:grid">
            <span>Student</span><span>Section</span><span>Face photos</span><span />
          </div>
          <ul className="divide-y divide-line">
            {shown.map((s) => (
              <li key={s.roll_no} className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 md:grid-cols-[1fr_140px_120px_96px] md:gap-4 md:px-5">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={s.name} seed={s.roll_no} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{s.name}</div>
                    <div className="font-mono text-xs text-muted">{s.roll_no}<span className="font-sans md:hidden"> · {s.section}</span></div>
                  </div>
                </div>
                <div className="hidden md:block"><Badge>{s.section}</Badge></div>
                <div className="hidden md:block">{s.face_count > 0 ? <Badge tone="present">{s.face_count} photo{s.face_count === 1 ? "" : "s"}</Badge> : <Badge tone="absent">none</Badge>}</div>
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" size="sm" aria-label={`Add photo for ${s.name}`} title="Add photo"
                    onClick={() => { setAddFor(s.roll_no); addRef.current?.click(); }}><ImagePlus className="size-4" /></Button>
                  <Button variant="ghost" size="sm" aria-label={`Delete ${s.name}`} title="Delete" onClick={() => setDel(s)}><Trash2 className="size-4" /></Button>
                </div>
              </li>
            ))}
            {shown.length === 0 && <li className="p-8 text-center text-sm text-muted">No students match.</li>}
          </ul>
        </Card>
      )}
      <p className="mt-3 text-xs text-muted">{shown.length} of {rows?.length ?? 0} students</p>

      <input ref={addRef} type="file" accept="image/*" hidden onChange={(e) => addPhotos(e.target.files)} />
      <EnrolDialog open={enrolOpen} onClose={() => setEnrolOpen(false)} onDone={() => { setEnrolOpen(false); load(); }} />
      <Confirm open={!!del} onClose={() => setDel(null)} onConfirm={remove} loading={deleting} danger confirmLabel="Delete student"
        title="Delete this student?"
        description={<>This permanently removes <b className="text-ink">{del?.name}</b> ({del?.roll_no}), their face data and their attendance history. It can&apos;t be undone.</>} />
    </>
  );
}

function EnrolDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach(URL.revokeObjectURL);
  }, [files]);
  useEffect(() => { if (!open) setFiles([]); }, [open]);

  const add = (list: FileList | null) => list && setFiles((f) => [...f, ...Array.from(list).filter((x) => x.type.startsWith("image/"))].slice(0, 3));

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!files.length) { toast("Add at least one admission photo", "err"); return; }
    const fd = new FormData(e.currentTarget);
    fd.delete("photos");
    files.forEach((f) => fd.append("photos", f));
    setBusy(true);
    try { await api("/api/students", { body: fd }); toast(`${fd.get("name")} enrolled`); onDone(); }
    catch (err) { toast((err as Error).message, "err"); }
    finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onClose={onClose} wide title="Enrol a student" description="The photo is checked for exactly one clear face, and refused if that face already belongs to another roll no.">
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Roll no"><Input name="roll_no" required maxLength={32} placeholder="22CS031" className="font-mono" /></Field>
        <Field label="Section"><Input name="section" required placeholder="CSE-3B" /></Field>
        <Field label="Full name" className="sm:col-span-2"><Input name="name" required placeholder="Student name" /></Field>
        <div className="sm:col-span-2">
          <div className="mb-1.5 text-[13px] font-medium">Admission photos <span className="font-normal text-muted">(up to 3)</span></div>
          <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}
            className={`flex flex-wrap gap-3 rounded-2xl border-2 border-dashed p-3 transition ${drag ? "border-brand bg-brand-soft" : "border-line"}`}>
            {previews.map((u, i) => (
              <div key={u} className="relative size-24 overflow-hidden rounded-xl">
                <img src={u} alt="" className="size-full object-cover" />
                <button type="button" aria-label="Remove photo" onClick={() => setFiles((f) => f.filter((_, j) => j !== i))}
                  className="absolute right-1 top-1 grid size-6 place-items-center rounded-full bg-black/60 text-white"><X className="size-3.5" /></button>
              </div>
            ))}
            {files.length < 3 && (
              <button type="button" onClick={() => inputRef.current?.click()}
                className="flex size-24 flex-col items-center justify-center gap-1 rounded-xl bg-surface-2 text-xs text-muted transition hover:text-ink">
                <UploadCloud className="size-5" /> Add photo
              </button>
            )}
            {files.length === 0 && <p className="self-center text-xs text-muted">Drop passport-style photos here, or click to choose.</p>}
          </div>
          <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
        </div>
        <div className="mt-2 flex flex-col-reverse gap-2 sm:col-span-2 sm:flex-row sm:justify-end">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy}>{busy ? "Checking face…" : "Enrol student"}</Button>
        </div>
      </form>
    </Dialog>
  );
}
