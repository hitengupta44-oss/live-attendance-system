"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { AlertTriangle, BarChart3, Download, Search } from "lucide-react";
import { api, type StudentReport, type Subject, type SubjectReport } from "@/lib/api";
import { pctTone } from "@/lib/format";
import { useToast } from "@/components/toast";
import { Avatar, Badge, Button, Card, Empty, Input, Meter, PageHeader, Segmented, Skeleton, Stat } from "@/components/ui";

type Sort = "low" | "roll";

export default function ReportsPage() {
  const toast = useToast();
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [rep, setRep] = useState<SubjectReport | null>(null);
  const [sort, setSort] = useState<Sort>("low");
  const [onlyLow, setOnlyLow] = useState(false);
  const [roll, setRoll] = useState("");
  const [stu, setStu] = useState<StudentReport | null>(null);
  const [looking, setLooking] = useState(false);

  useEffect(() => {
    api<Subject[]>("/api/subjects").then((s) => { setSubjects(s); if (s.length) setSel(s[0].id); }).catch((e) => toast(e.message, "err"));
  }, [toast]);

  const load = useCallback((id: number) => { setRep(null); api<SubjectReport>(`/api/reports/subject/${id}`).then(setRep).catch((e) => toast(e.message, "err")); }, [toast]);
  useEffect(() => { if (sel != null) load(sel); }, [sel, load]);

  const list = useMemo(() => {
    if (!rep) return [];
    let xs = [...rep.students];
    if (onlyLow) xs = xs.filter((s) => s.percent != null && s.percent < 75);
    return xs.sort((a, b) => sort === "roll" ? a.roll_no.localeCompare(b.roll_no) : (a.percent ?? 101) - (b.percent ?? 101) || a.roll_no.localeCompare(b.roll_no));
  }, [rep, sort, onlyLow]);

  const pcts = rep?.students.map((s) => s.percent).filter((p): p is number => p != null) ?? [];
  const avg = pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null;
  const low = pcts.filter((p) => p < 75).length;

  function exportCsv() {
    if (!rep) return;
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [["Roll no", "Name", "Attended", "Lectures", "Percent"], ...rep.students.map((s) => [s.roll_no, s.name, s.attended, s.total, s.percent ?? ""])];
    const blob = new Blob([lines.map((l) => l.map(esc).join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${rep.subject.code}_${rep.subject.section}_attendance.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    if (!roll.trim()) return;
    setLooking(true);
    try { setStu(await api<StudentReport>(`/api/reports/student/${encodeURIComponent(roll.trim())}`)); }
    catch (err) { toast((err as Error).message, "err"); setStu(null); }
    finally { setLooking(false); }
  }

  return (
    <>
      <PageHeader eyebrow="Insights" title="Reports" subtitle="Attendance per subject from saved lectures. Students below 75% are flagged." />

      {subjects === null ? <Skeleton className="h-10 w-80" /> : subjects.length === 0 ? (
        <Empty icon={<BarChart3 className="size-5" />} title="Nothing to report yet">Reports appear once lectures are saved.</Empty>
      ) : (
        <>
          <div className="-mx-4 mb-6 overflow-x-auto px-4">
            <div className="flex gap-2">
              {subjects.map((s) => (
                <button key={s.id} onClick={() => setSel(s.id)}
                  className={clsx("flex shrink-0 flex-col items-start rounded-2xl border px-4 py-2.5 text-left transition",
                    sel === s.id ? "border-brand bg-brand-soft" : "border-line bg-surface hover:bg-surface-2")}>
                  <span className={clsx("font-mono text-xs", sel === s.id ? "text-brand" : "text-muted")}>{s.code} · {s.section}</span>
                  <span className="text-sm font-medium">{s.name}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {!rep ? [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[104px]" />) : <>
              <Stat label="Lectures saved" value={rep.lectures} tone="brand" />
              <Stat label="Average attendance" value={avg == null ? "–" : `${avg}%`} tone={avg == null ? undefined : (pctTone(avg) as "present")} />
              <Stat label="Below 75%" value={low} tone={low ? "absent" : "present"} sub={low ? "need a warning" : "everyone on track"} />
              <Stat label="Students" value={rep.students.length} />
            </>}
          </div>

          <div className="grid items-start gap-6 lg:grid-cols-[1.6fr_1fr]">
            <Card className="overflow-hidden">
              <div className="flex flex-wrap items-center gap-2 border-b border-line p-4">
                <Segmented value={sort} onChange={setSort} options={[{ value: "low", label: "Lowest first" }, { value: "roll", label: "Roll no" }]} />
                <button onClick={() => setOnlyLow((v) => !v)} aria-pressed={onlyLow}
                  className={clsx("flex h-10 items-center gap-1.5 rounded-xl border px-3 text-[13px] font-medium transition",
                    onlyLow ? "border-absent bg-absent-soft text-absent" : "border-line text-muted hover:text-ink")}>
                  <AlertTriangle className="size-3.5" /> Below 75%
                </button>
                <Button size="md" className="ml-auto" onClick={exportCsv} disabled={!rep}><Download className="size-4" /> CSV</Button>
              </div>
              {!rep ? <div className="space-y-3 p-5">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10" />)}</div>
                : rep.lectures === 0 ? <div className="p-10 text-center text-sm text-muted">No saved lectures for this subject yet.</div>
                : (
                  <ul className="divide-y divide-line">
                    {list.map((s) => (
                      <li key={s.roll_no} className="flex items-center gap-3 px-4 py-3">
                        <Avatar name={s.name} seed={s.roll_no} size={32} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-sm font-medium">{s.name}</span>
                            <span className="shrink-0 text-xs tabular-nums text-muted">{s.attended}/{s.total}</span>
                          </div>
                          <div className="relative mt-1.5">
                            <Meter value={s.percent ?? 0} tone={pctTone(s.percent)} />
                            <span className="absolute -top-0.5 h-2.5 w-px bg-ink/40" style={{ left: "75%" }} aria-hidden />
                          </div>
                        </div>
                        <span className={clsx("w-12 text-right font-display text-xl tabular-nums",
                          `text-${pctTone(s.percent) === "muted" ? "muted" : pctTone(s.percent)}`)}>{s.percent == null ? "–" : `${Math.round(s.percent)}%`}</span>
                      </li>
                    ))}
                    {list.length === 0 && <li className="p-8 text-center text-sm text-muted">Everyone is at or above 75%. 🎉</li>}
                  </ul>
                )}
            </Card>

            <Card className="p-5">
              <h2 className="font-display text-2xl">Student lookup</h2>
              <p className="mt-1 text-sm text-muted">One student across every subject.</p>
              <form onSubmit={lookup} className="mt-4 flex gap-2">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
                  <Input value={roll} onChange={(e) => setRoll(e.target.value)} placeholder="Roll no, e.g. 22CS005" className="pl-9 font-mono" />
                </div>
                <Button loading={looking}>Find</Button>
              </form>
              {stu && (
                <div className="rise mt-5">
                  <div className="flex items-center gap-3">
                    <Avatar name={stu.student.name} seed={stu.student.roll_no} size={40} />
                    <div><div className="font-medium">{stu.student.name}</div><div className="font-mono text-xs text-muted">{stu.student.roll_no} · {stu.student.section}</div></div>
                  </div>
                  <ul className="mt-4 space-y-3">
                    {stu.subjects.map((s) => (
                      <li key={s.code}>
                        <div className="mb-1 flex items-baseline justify-between text-sm">
                          <span className="truncate">{s.name}</span>
                          <Badge tone={pctTone(s.percent)}>{s.percent == null ? "no lectures" : `${Math.round(s.percent)}% · ${s.attended}/${s.total}`}</Badge>
                        </div>
                        <Meter value={s.percent ?? 0} tone={pctTone(s.percent)} />
                      </li>
                    ))}
                    {stu.subjects.length === 0 && <li className="text-sm text-muted">No subjects you can see for this student.</li>}
                  </ul>
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </>
  );
}
