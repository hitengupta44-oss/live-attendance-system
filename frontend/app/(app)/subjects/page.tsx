"use client";
import { useCallback, useEffect, useState } from "react";
import { BookOpen, LocateFixed, MapPin, Plus, Trash2, Users } from "lucide-react";
import { api, type Subject, type User } from "@/lib/api";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, Confirm, Dialog, Empty, Field, Input, PageHeader, Select, Skeleton } from "@/components/ui";

export default function SubjectsPage() {
  const toast = useToast();
  const [rows, setRows] = useState<Subject[] | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [open, setOpen] = useState(false);
  const [del, setDel] = useState<Subject | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(() => Promise.all([api<Subject[]>("/api/subjects"), api<User[]>("/api/users")])
    .then(([s, u]) => { setRows(s); setUsers(u); }).catch((e) => toast(e.message, "err")), [toast]);
  useEffect(() => { load(); }, [load]);

  async function remove() {
    if (!del) return;
    setDeleting(true);
    try { await api(`/api/subjects/${del.id}`, { method: "DELETE" }); toast(`${del.code} deleted`); setDel(null); load(); }
    catch (e) { toast((e as Error).message, "err"); }
    finally { setDeleting(false); }
  }

  return (
    <>
      <PageHeader eyebrow="Admin" title="Subjects"
        subtitle="Each subject belongs to one section and one teacher. Add the classroom's location to accept photos only from inside the room."
        actions={<Button variant="primary" onClick={() => setOpen(true)}><Plus className="size-4" /> New subject</Button>} />

      {rows === null ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-48" />)}</div>
        : rows.length === 0 ? (
          <Empty icon={<BookOpen className="size-5" />} title="No subjects yet" action={<Button variant="primary" onClick={() => setOpen(true)}><Plus className="size-4" /> Create a subject</Button>}>
            Subjects A, B, C, D… each get their own attendance record.
          </Empty>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((s) => (
              <Card key={s.id} className="flex flex-col p-5">
                <div className="flex items-start justify-between">
                  <Badge tone="brand" className="font-mono">{s.code}</Badge>
                  <Button variant="ghost" size="sm" aria-label={`Delete ${s.code}`} onClick={() => setDel(s)}><Trash2 className="size-4" /></Button>
                </div>
                <h3 className="mt-2 text-lg font-semibold leading-snug">{s.name}</h3>
                <div className="mt-4 space-y-2 text-sm text-muted">
                  <div className="flex items-center gap-2"><Users className="size-4" /> Section {s.section} · {s.student_count} students</div>
                  <div className="flex items-center gap-2"><BookOpen className="size-4" /> {s.teacher_name}</div>
                  <div className="flex items-center gap-2"><MapPin className="size-4" />
                    {s.room_lat != null
                      ? <span>{s.room_name || "Room"} · <span className="text-present">geofenced ±{s.room_radius_m} m</span></span>
                      : <span>{s.room_name || "No room"} · no geofence</span>}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}

      <SubjectDialog open={open} users={users} onClose={() => setOpen(false)} onDone={() => { setOpen(false); load(); }} />
      <Confirm open={!!del} onClose={() => setDel(null)} onConfirm={remove} loading={deleting} danger confirmLabel="Delete subject"
        title="Delete this subject?" description={<>Deleting <b className="text-ink">{del?.code} · {del?.name}</b> also deletes every lecture and attendance record for it. This can&apos;t be undone.</>} />
    </>
  );
}

function SubjectDialog({ open, users, onClose, onDone }: { open: boolean; users: User[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [radius, setRadius] = useState(80);
  useEffect(() => { if (!open) { setLat(""); setLng(""); setRadius(80); } }, [open]);

  function here() {
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { setLat(p.coords.latitude.toFixed(6)); setLng(p.coords.longitude.toFixed(6)); setLocating(false);
        toast(`Location set (±${Math.round(p.coords.accuracy)} m)`); },
      (e) => { toast(`Location: ${e.message}`, "err"); setLocating(false); },
      { enableHighAccuracy: true, timeout: 20000 });
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const hasLoc = lat !== "" && lng !== "";
    setBusy(true);
    try {
      await api("/api/subjects", { body: {
        code: f.get("code"), name: f.get("name"), section: f.get("section"), teacher_id: String(f.get("teacher_id")),
        room_name: f.get("room_name") || null,
        room_lat: hasLoc ? Number(lat) : null, room_lng: hasLoc ? Number(lng) : null, room_radius_m: hasLoc ? radius : null,
      } });
      toast("Subject created"); onDone();
    } catch (err) { toast((err as Error).message, "err"); }
    finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onClose={onClose} wide title="New subject">
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Code"><Input name="code" required placeholder="CS301" className="font-mono" /></Field>
        <Field label="Section"><Input name="section" required placeholder="CSE-3B" /></Field>
        <Field label="Subject name" className="sm:col-span-2"><Input name="name" required placeholder="Data Structures" /></Field>
        <Field label="Teacher" className="sm:col-span-2">
          <Select name="teacher_id" required>
            {users.map((u) => <option key={u.id} value={u.id}>{u.full_name} ({u.email})</option>)}
          </Select>
        </Field>

        <div className="rounded-2xl bg-surface-2 p-4 sm:col-span-2">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Classroom geofence <span className="font-normal text-muted">(optional)</span></div>
              <p className="text-xs text-muted">Stand inside the room and tap “Use my location”. Photos taken outside the radius are refused.</p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr]">
            <Field label="Room"><Input name="room_name" placeholder="Room 204" /></Field>
            <Field label="Latitude"><Input value={lat} onChange={(e) => setLat(e.target.value)} type="number" step="any" min={-90} max={90} /></Field>
            <Field label="Longitude"><Input value={lng} onChange={(e) => setLng(e.target.value)} type="number" step="any" min={-180} max={180} /></Field>
          </div>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button type="button" size="sm" loading={locating} onClick={here}><LocateFixed className="size-4" /> Use my location</Button>
            <label className="flex flex-1 items-center gap-3 text-xs text-muted">
              Radius
              <input type="range" min={20} max={300} step={10} value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="flex-1 accent-[var(--brand)]" aria-label="Geofence radius in metres" />
              <span className="w-12 text-right font-medium tabular-nums text-ink">{radius} m</span>
            </label>
          </div>
        </div>

        <div className="mt-2 flex flex-col-reverse gap-2 sm:col-span-2 sm:flex-row sm:justify-end">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy}>Create subject</Button>
        </div>
      </form>
    </Dialog>
  );
}
