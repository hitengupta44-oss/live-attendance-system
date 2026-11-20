"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, BookOpen, Camera, Clock3, MapPin, Radio } from "lucide-react";
import { api, type SessionRow, type Subject, type SubjectReport } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDate, fmtTime, greeting, pctTone } from "@/lib/format";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, Empty, Meter, PageHeader, Skeleton, Stat } from "@/components/ui";

interface Row { subject: Subject; sessions: SessionRow[]; avg: number | null; lectures: number }

function firstName(full: string) {
  const parts = full.replace(/^(prof\.?|dr\.?|mr\.?|ms\.?|mrs\.?)\s+/i, "").split(/\s+/);
  return parts[0] || full;
}

export default function Dashboard() {
  const { user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [starting, setStarting] = useState<number | null>(null);

  const load = useCallback(async () => {
    const subjects = await api<Subject[]>("/api/subjects");
    const out = await Promise.all(subjects.map(async (subject) => {
      const [sessions, rep] = await Promise.all([
        api<SessionRow[]>(`/api/sessions?subject_id=${subject.id}`),
        api<SubjectReport>(`/api/reports/subject/${subject.id}`),
      ]);
      const pcts = rep.students.map((s) => s.percent).filter((p): p is number => p != null);
      return { subject, sessions, lectures: rep.lectures, avg: pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null };
    }));
    setRows(out);
  }, []);

  useEffect(() => { load().catch((e) => { toast(e.message, "err"); setRows([]); }); }, [load, toast]);

  async function start(subjectId: number) {
    setStarting(subjectId);
    try {
      const r = await api<{ id: number }>("/api/sessions", { body: { subject_id: subjectId } });
      router.push(`/lecture/${r.id}`);
    } catch (e) { toast((e as Error).message, "err"); setStarting(null); }
  }

  const open = rows?.flatMap((r) => r.sessions.filter((s) => s.status === "open").map((s) => ({ s, subject: r.subject }))) ?? [];
  const recent = (rows?.flatMap((r) => r.sessions.filter((s) => s.status === "finalized").map((s) => ({ s, subject: r.subject }))) ?? [])
    .sort((a, b) => b.s.started_at.localeCompare(a.s.started_at)).slice(0, 6);
  const sections = new Map(rows?.map((r) => [r.subject.section, r.subject.student_count]));
  const students = [...sections.values()].reduce((a, b) => a + b, 0);
  const lectures = rows?.reduce((a, r) => a + r.lectures, 0) ?? 0;
  const avgs = rows?.map((r) => r.avg).filter((a): a is number => a != null) ?? [];
  const overall = avgs.length ? Math.round(avgs.reduce((a, b) => a + b, 0) / avgs.length) : null;

  return (
    <>
      <PageHeader
        eyebrow={new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
        title={<>{greeting()}, <span className="italic">{user ? firstName(user.full_name) : ""}.</span></>}
        subtitle="Pick a subject and take one live photo of the class — attendance is marked from the faces it sees."
      />

      {/* stats */}
      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {rows === null ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[104px]" />) : <>
          <Stat label="Subjects" value={rows.length} />
          <Stat label="Students" value={students} sub={`${sections.size} section${sections.size === 1 ? "" : "s"}`} />
          <Stat label="Lectures recorded" value={lectures} tone="brand" />
          <Stat label="Average attendance" value={overall == null ? "–" : `${overall}%`} tone={overall == null ? undefined : pctTone(overall) === "muted" ? undefined : pctTone(overall) as "present" | "confirm" | "absent"} />
        </>}
      </div>

      {/* resume open lectures */}
      {open.length > 0 && (
        <div className="mb-8 flex flex-col gap-2">
          {open.slice(0, 3).map(({ s, subject }) => (
            <Link key={s.id} href={`/lecture/${s.id}`}
              className="rise group flex items-center gap-4 rounded-2xl border border-confirm/30 bg-confirm-soft px-4 py-3 transition hover:brightness-[.98]">
              <Radio className="size-5 shrink-0 text-confirm" />
              <div className="min-w-0 flex-1 text-sm">
                <span className="font-semibold">{subject.code} lecture not saved yet</span>
                <span className="text-muted"> · started {fmtDate(s.started_at)}, {fmtTime(s.started_at)} · {s.photo_count} photo{s.photo_count === 1 ? "" : "s"}</span>
              </div>
              <span className="flex items-center gap-1 text-sm font-medium text-confirm">Resume <ArrowUpRight className="size-4 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" /></span>
            </Link>
          ))}
        </div>
      )}

      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="font-display text-[28px]">Your subjects</h2>
      </div>

      {rows === null ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-[230px]" />)}</div>
      ) : rows.length === 0 ? (
        <Empty icon={<BookOpen className="size-5" />} title="No subjects yet"
          action={user?.role === "admin" ? <Link href="/subjects"><Button variant="primary">Create a subject</Button></Link> : undefined}>
          {user?.role === "admin" ? "Create subjects and assign teachers to start taking attendance." : "Ask your admin to assign your subjects."}
        </Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map(({ subject, avg, lectures: n, sessions }, i) => {
            const last = sessions.find((s) => s.status === "finalized");
            return (
              <Card key={subject.id} className="rise flex flex-col p-5" style={{ animationDelay: `${i * 50}ms` }}>
                <div className="flex items-start justify-between gap-3">
                  <Badge tone="brand" className="font-mono">{subject.code}</Badge>
                  <span className="text-xs text-muted">Section {subject.section}</span>
                </div>
                <h3 className="mt-3 text-lg font-semibold leading-snug">{subject.name}</h3>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                  <span>{subject.student_count} students</span>
                  {subject.room_name && <span className="flex items-center gap-1"><MapPin className="size-3" />{subject.room_name}</span>}
                  {user?.role === "admin" && <span>{subject.teacher_name}</span>}
                </div>
                <div className="mt-5">
                  <div className="mb-1.5 flex items-baseline justify-between text-xs">
                    <span className="text-muted">{n} lecture{n === 1 ? "" : "s"} · avg attendance</span>
                    <span className="font-semibold tabular-nums">{avg == null ? "–" : `${Math.round(avg)}%`}</span>
                  </div>
                  <Meter value={avg ?? 0} tone={pctTone(avg)} />
                </div>
                <div className="mt-auto flex items-center gap-2 pt-5">
                  <Button variant="primary" className="flex-1" loading={starting === subject.id} onClick={() => start(subject.id)}>
                    <Camera className="size-4" /> Start lecture
                  </Button>
                  {last && (
                    <Link href={`/lecture/${last.id}`} title="Last lecture">
                      <Button variant="ghost" size="md" aria-label="Open last lecture"><Clock3 className="size-4" /></Button>
                    </Link>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {recent.length > 0 && (
        <>
          <h2 className="mb-4 mt-12 font-display text-[28px]">Recent lectures</h2>
          <Card className="divide-y divide-line">
            {recent.map(({ s, subject }) => (
              <Link key={s.id} href={`/lecture/${s.id}`} className="flex items-center gap-4 px-5 py-3.5 transition hover:bg-surface-2/60">
                <div className="w-14 shrink-0 text-center">
                  <div className="text-[11px] uppercase tracking-wide text-muted">{new Date(s.started_at).toLocaleDateString(undefined, { month: "short" })}</div>
                  <div className="font-display text-2xl leading-none">{new Date(s.started_at).getDate()}</div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{subject.name}</div>
                  <div className="text-xs text-muted">{subject.code} · {fmtTime(s.started_at)}</div>
                </div>
                <div className="text-right">
                  <div className="font-semibold tabular-nums">{s.present}<span className="text-muted">/{subject.student_count}</span></div>
                  <div className="text-[11px] text-muted">present</div>
                </div>
              </Link>
            ))}
          </Card>
        </>
      )}
    </>
  );
}
