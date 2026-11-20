"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import clsx from "clsx";
import { ArrowLeft, Check, CheckCircle2, Images, Lightbulb, MapPin, Search, UserX } from "lucide-react";
import { api, imageUrl, type PhotoInfo, type RosterEntry, type SessionSummary } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDateTime, fmtTime } from "@/lib/format";
import { LiveCamera } from "@/components/camera";
import { useToast } from "@/components/toast";
import { Avatar, Badge, Button, Card, Confirm, Input, Segmented, Skeleton } from "@/components/ui";

type Filter = "all" | "present" | "review" | "absent";

export default function LecturePage() {
  const { id } = useParams<{ id: string }>();
  const sessionId = Number(id);
  const { user } = useAuth();
  const toast = useToast();
  const [data, setData] = useState<SessionSummary | null>(null);
  const [manual, setManual] = useState<Map<string, boolean>>(new Map());
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => api<SessionSummary>(`/api/sessions/${sessionId}`).then(setData), [sessionId]);
  useEffect(() => { load().catch((e) => toast(e.message, "err")); }, [load, toast]);

  const finalized = data?.session.status === "finalized";
  const canEdit = !!data && (!finalized || user?.role === "admin");

  const isPresent = useCallback((s: RosterEntry) => {
    const m = manual.get(s.roll_no);
    if (m !== undefined) return m;
    return finalized ? s.final_status === "present" : s.detected === "matched";
  }, [manual, finalized]);

  const toggle = (s: RosterEntry) => {
    if (!canEdit) return;
    setManual((prev) => new Map(prev).set(s.roll_no, !isPresent(s)));
  };

  const students = useMemo(() => data?.students ?? [], [data]);
  const presentCount = students.filter(isPresent).length;
  const reviewLeft = students.filter((s) => s.detected === "review" && !manual.has(s.roll_no) && !finalized).length;
  const changes = students.filter((s) => manual.has(s.roll_no) && manual.get(s.roll_no) !== (finalized ? s.final_status === "present" : s.detected === "matched")).length;

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return students.filter((s) => {
      if (needle && !s.name.toLowerCase().includes(needle) && !s.roll_no.toLowerCase().includes(needle)) return false;
      if (filter === "present") return isPresent(s);
      if (filter === "absent") return !isPresent(s);
      if (filter === "review") return s.detected === "review";
      return true;
    }).sort((a, b) => {
      const rank = (s: RosterEntry) => (s.detected === "review" && !finalized ? 0 : 1);
      return rank(a) - rank(b) || a.roll_no.localeCompare(b.roll_no);
    });
  }, [students, q, filter, isPresent, finalized]);

  async function save() {
    setSaving(true);
    try {
      const present = students.filter(isPresent).map((s) => s.roll_no);
      const r = await api<SessionSummary>(`/api/sessions/${sessionId}/finalize`, { body: { present } });
      setData(r); setManual(new Map()); setConfirmOpen(false);
      toast(`Attendance saved · ${present.length} present, ${students.length - present.length} absent`);
    } catch (e) { toast((e as Error).message, "err"); }
    finally { setSaving(false); }
  }

  if (!data) {
    return <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]"><Skeleton className="aspect-video" /><Skeleton className="h-[480px]" /></div>;
  }
  const { subject, session, counts } = data;

  return (
    <>
      <Link href="/dashboard" className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" /> Lectures</Link>

      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge tone="brand" className="font-mono">{subject.code}</Badge>
            <Badge>Section {subject.section}</Badge>
            {finalized ? <Badge tone="present"><CheckCircle2 className="size-3" /> Saved</Badge> : <Badge tone="confirm"><span className="live-dot size-1.5 rounded-full bg-confirm" /> In progress</Badge>}
          </div>
          <h1 className="font-display text-[34px] leading-[1.05] tracking-tight md:text-[44px]">{subject.name}</h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 text-sm text-muted">
            <span>Started {fmtDateTime(session.started_at)}</span>
            {subject.room_name && <span className="flex items-center gap-1"><MapPin className="size-3.5" />{subject.room_name}</span>}
            {session.teacher_name && <span>{session.teacher_name}</span>}
          </p>
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[1.25fr_1fr]">
        {/* ---------- left: camera + evidence ---------- */}
        <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-8">
          {!finalized && <LiveCamera sessionId={sessionId} onResult={(r) => setData(r)} />}
          {!finalized && data.photos.length === 0 && (
            <div className="flex gap-3 rounded-2xl border border-line bg-surface p-4 text-sm text-muted">
              <Lightbulb className="mt-0.5 size-4 shrink-0 text-brand" />
              <span>Stand at the front and ask students to look up for 3 seconds. For big rooms take 2–3 photos — left, centre, right. Results from every photo are combined.</span>
            </div>
          )}
          <Evidence photos={data.photos} large={finalized} />
        </div>

        {/* ---------- right: summary + roster ---------- */}
        <Card className="min-w-0 overflow-hidden">
          <div className="flex items-center gap-5 border-b border-line p-5">
            <Ring total={counts.total} present={presentCount} review={finalized ? 0 : counts.needs_review} />
            <div className="grid flex-1 grid-cols-3 gap-2 text-center">
              <Mini n={counts.auto_present} label="recognised" tone="text-present" />
              <Mini n={counts.needs_review} label="to confirm" tone="text-confirm" />
              <Mini n={counts.not_seen} label="not seen" tone="text-muted" />
            </div>
          </div>

          <div className="flex flex-col gap-3 border-b border-line p-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <Input placeholder="Search name or roll no" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
            </div>
            <Segmented value={filter} onChange={setFilter} options={[
              { value: "all", label: <>All <span className="text-muted">{students.length}</span></> },
              { value: "present", label: <>Present <span className="text-muted">{presentCount}</span></> },
              { value: "review", label: <>Confirm <span className="text-muted">{counts.needs_review}</span></> },
              { value: "absent", label: <>Absent <span className="text-muted">{students.length - presentCount}</span></> },
            ]} />
          </div>

          {students.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted">No students are enrolled in section {subject.section}.</div>
          ) : (
            <ul className="max-h-[62dvh] divide-y divide-line overflow-y-auto">
              {shown.map((s) => <RosterRow key={s.roll_no} s={s} present={isPresent(s)} edited={manual.has(s.roll_no)} finalized={finalized} canEdit={canEdit} onToggle={() => toggle(s)} />)}
              {shown.length === 0 && <li className="p-8 text-center text-sm text-muted">Nobody matches this filter.</li>}
            </ul>
          )}

          {canEdit && students.length > 0 && (
            <div className="sticky bottom-0 flex items-center gap-3 border-t border-line bg-surface/95 p-4 backdrop-blur max-md:fixed max-md:inset-x-0 max-md:bottom-[calc(57px+env(safe-area-inset-bottom))] max-md:z-20">
              <div className="min-w-0 flex-1 text-sm">
                <div className="font-semibold tabular-nums">{presentCount} present · {students.length - presentCount} absent</div>
                <div className="truncate text-xs text-muted">
                  {!finalized && data.photos.length === 0 ? "Take a class photo first" : reviewLeft > 0 ? `${reviewLeft} still to confirm` : changes > 0 ? `${changes} manual change${changes === 1 ? "" : "s"} — will be logged` : finalized ? "Admin edit" : "Ready to save"}
                </div>
              </div>
              <Button variant="primary" disabled={!finalized && data.photos.length === 0} onClick={() => setConfirmOpen(true)}>
                <Check className="size-4" /> {finalized ? "Update" : "Save attendance"}
              </Button>
            </div>
          )}
        </Card>
      </div>
      {canEdit && <div className="h-20 md:hidden" />}

      <Confirm open={confirmOpen} onClose={() => setConfirmOpen(false)} onConfirm={save} loading={saving}
        title={finalized ? "Update attendance?" : "Save attendance?"} confirmLabel={finalized ? "Update" : "Save"}
        description={<div className="space-y-2">
          <p><b className="text-ink">{presentCount}</b> present and <b className="text-ink">{students.length - presentCount}</b> absent in {subject.code}.</p>
          {changes > 0 && <p>{changes} manual change{changes === 1 ? "" : "s"} will be recorded in the audit log.</p>}
          {reviewLeft > 0 && <p className="text-confirm">{reviewLeft} uncertain match{reviewLeft === 1 ? " is" : "es are"} not ticked and will be saved as absent.</p>}
          {!finalized && <p>After saving, only an admin can change this lecture.</p>}
        </div>} />
    </>
  );
}

function Mini({ n, label, tone }: { n: number; label: string; tone: string }) {
  return <div><div className={clsx("font-display text-[28px] leading-none tabular-nums", tone)}>{n}</div><div className="mt-1 text-[11px] text-muted">{label}</div></div>;
}

function Ring({ total, present, review }: { total: number; present: number; review: number }) {
  const r = 34, c = 2 * Math.PI * r;
  const p = total ? present / total : 0;
  const rv = total ? review / total : 0;
  return (
    <div className="relative size-[86px] shrink-0">
      <svg viewBox="0 0 80 80" className="size-full -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="8" />
        {p + rv > 0 && <circle cx="40" cy="40" r={r} fill="none" stroke="var(--confirm)" strokeWidth="8" strokeDasharray={`${c * (p + rv)} ${c}`} strokeLinecap="round" className="transition-all duration-700" />}
        {p > 0 && <circle cx="40" cy="40" r={r} fill="none" stroke="var(--present)" strokeWidth="8" strokeDasharray={`${c * p} ${c}`} strokeLinecap="round" className="transition-all duration-700" />}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div><div className="font-display text-[26px] leading-none tabular-nums">{present}</div><div className="text-[10px] text-muted">of {total}</div></div>
      </div>
    </div>
  );
}

function RosterRow({ s, present, edited, finalized, canEdit, onToggle }: {
  s: RosterEntry; present: boolean; edited: boolean; finalized: boolean; canEdit: boolean; onToggle: () => void;
}) {
  const review = s.detected === "review" && !finalized;
  return (
    <li>
      <button type="button" onClick={onToggle} disabled={!canEdit} aria-pressed={present} aria-label={`${s.name}, ${present ? "present" : "absent"}`}
        className={clsx("flex w-full items-center gap-3 px-4 py-3 text-left transition", canEdit && "hover:bg-surface-2/60", review && !edited && "bg-confirm-soft/60")}>
        <span className={clsx("grid size-6 shrink-0 place-items-center rounded-lg border-2 transition",
          present ? "border-present bg-present text-white" : "border-line bg-surface")}>
          {present && <Check className="size-4" strokeWidth={3} />}
        </span>
        <Avatar name={s.name} seed={s.roll_no} size={34} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{s.name}</span>
          <span className="flex items-center gap-2 font-mono text-xs text-muted">
            {s.roll_no}
            {!s.enrolled_face && <span className="font-sans text-absent">no face photo</span>}
          </span>
        </span>
        <span className="flex flex-col items-end gap-1">
          {finalized ? (
            s.final_status === "present" ? <Badge tone="present">Present</Badge> : <Badge tone="absent">Absent</Badge>
          ) : s.detected === "matched" ? <Badge tone="present">Recognised</Badge>
            : s.detected === "review" ? <Badge tone="confirm">Confirm?</Badge>
            : <Badge><UserX className="size-3" /> Not seen</Badge>}
          <span className="text-[11px] tabular-nums text-muted">
            {edited ? "edited" : finalized && s.final_source === "teacher" ? "manual" : s.similarity != null ? `${Math.round(s.similarity * 100)}% match` : ""}
          </span>
        </span>
      </button>
    </li>
  );
}

function Evidence({ photos, large }: { photos: PhotoInfo[]; large?: boolean }) {
  const [urls, setUrls] = useState<Record<number, string>>({});
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    photos.forEach((p) => {
      if (urls[p.id]) return;
      imageUrl(`/api/photos/${p.id}/annotated`).then((u) => setUrls((x) => ({ ...x, [p.id]: u }))).catch(() => {});
    });
  }, [photos, urls]);
  useEffect(() => {
    if (open == null) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [open]);
  if (!photos.length) return null;
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-sm font-medium"><Images className="size-4 text-muted" /> Evidence <span className="text-muted">· {photos.length}</span></div>
      <div className={clsx("grid gap-3", large ? "grid-cols-1 sm:grid-cols-2 [&>*:first-child]:sm:col-span-2" : "grid-cols-2 sm:grid-cols-3")}>
        {photos.map((p) => (
          <button key={p.id} onClick={() => setOpen(p.id)} className="group rise overflow-hidden rounded-2xl border border-line bg-surface text-left shadow-card">
            {urls[p.id] ? <img src={urls[p.id]} alt={`Class photo at ${fmtTime(p.captured_at)}`} className="aspect-video w-full object-cover transition group-hover:scale-[1.02]" /> : <div className="skeleton aspect-video rounded-none" />}
            <div className="space-y-0.5 p-2.5 text-[11px] text-muted">
              <div className="font-medium text-ink">{fmtTime(p.captured_at)} · {p.faces_detected} faces</div>
              <div><span className="text-present">{p.matched} matched</span>{p.review > 0 && <> · <span className="text-confirm">{p.review} check</span></>}{p.unknown > 0 && <> · <span className="text-absent">{p.unknown} unknown</span></>}</div>
            </div>
          </button>
        ))}
      </div>
      {open != null && urls[open] && (
        <div className="fixed inset-0 z-50 grid cursor-zoom-out place-items-center bg-black/90 p-4" onClick={() => setOpen(null)} role="dialog" aria-label="Class photo">
          <img src={urls[open]} alt="Annotated class photo" className="max-h-full max-w-full rounded-xl" />
        </div>
      )}
    </div>
  );
}
