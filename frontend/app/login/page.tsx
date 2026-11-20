"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Lock, MapPin, ScanFace, Timer } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/components/toast";
import { Button, Field, Input } from "@/components/ui";
import { Wordmark } from "@/components/logo";

const ROLL = ["AS", "PN", "SI", "RK", "AM", "RV", "KR", "AJ", "MP", "IG", "PD", "VS", "KM", "RB", "NA", "SR", "NC", "DM", "AK", "TK", "HP", "ZS", "AS", "KB"];
const ABSENT = new Set([3, 9, 14, 20]);

export default function LoginPage() {
  const { user, ready, login } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (ready && user) router.replace("/dashboard"); }, [ready, user, router]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await login(String(f.get("email")).trim().toLowerCase(), String(f.get("password")));
      // the effect above redirects once the user is set
    } catch (err) {
      toast((err as Error).message, "err");
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      {/* brand panel */}
      <section className="relative hidden overflow-hidden bg-rail p-12 text-rail-ink lg:flex lg:flex-col">
        <div className="absolute inset-0 opacity-[0.35]" style={{ backgroundImage: "radial-gradient(rgba(255,255,255,.12) 1px, transparent 1px)", backgroundSize: "22px 22px" }} />
        <div className="absolute -right-32 -top-32 size-[480px] rounded-full bg-[#3d3df5] opacity-30 blur-[120px]" />
        <div className="relative"><Wordmark light /></div>

        <div className="relative mt-auto">
          <h1 className="font-display text-[64px] leading-[0.95] tracking-tight">
            Every face,<br /><span className="italic text-[#a5a5ff]">accounted for.</span>
          </h1>
          <p className="mt-5 max-w-md text-[15px] leading-relaxed text-rail-muted">
            One live photo marks the whole class. Matched to admission photos, stamped with time and place — no roll call, no proxies.
          </p>

          {/* illustrative live roll */}
          <div className="mt-10 max-w-md rounded-3xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur">
            <div className="mb-4 flex items-center justify-between text-xs">
              <span className="flex items-center gap-2 font-medium"><span className="live-dot size-2 rounded-full bg-[#ff5d5d]" /> CS301 · Data Structures</span>
              <span className="text-rail-muted">20 / 24 present</span>
            </div>
            <div className="grid grid-cols-8 gap-2">
              {ROLL.map((r, i) => (
                <div key={i} className={`grid aspect-square place-items-center rounded-full text-[10px] font-semibold ${ABSENT.has(i)
                  ? "border border-dashed border-white/20 text-white/30" : "bg-[#34d399]/15 text-[#6ee7b7] ring-1 ring-[#34d399]/40"}`}>{r}</div>
              ))}
            </div>
            <div className="mt-5 grid grid-cols-3 gap-2 text-[11px] text-rail-muted">
              <span className="flex items-center gap-1.5"><ScanFace className="size-3.5" /> Face match</span>
              <span className="flex items-center gap-1.5"><MapPin className="size-3.5" /> Geofenced</span>
              <span className="flex items-center gap-1.5"><Timer className="size-3.5" /> Live only</span>
            </div>
          </div>
        </div>
      </section>

      {/* form */}
      <section className="flex flex-col px-6 py-8 sm:px-12">
        <div className="lg:hidden"><Wordmark /></div>
        <div className="m-auto w-full max-w-sm py-10">
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-brand">Faculty sign in</div>
          <h2 className="font-display text-[44px] leading-none tracking-tight">Welcome back.</h2>
          <p className="mt-3 text-[15px] text-muted">Sign in to take today&apos;s attendance.</p>
          <form onSubmit={submit} className="mt-8 flex flex-col gap-4">
            <Field label="Email"><Input name="email" type="email" autoComplete="email" required autoFocus placeholder="you@college.edu" /></Field>
            <Field label="Password"><Input name="password" type="password" autoComplete="current-password" required /></Field>
            <Button variant="primary" size="lg" loading={busy} className="mt-2 w-full">
              Sign in <ArrowRight className="size-4" />
            </Button>
          </form>
          <p className="mt-8 flex items-center gap-2 text-xs text-muted">
            <Lock className="size-3.5" /> Accounts are created by your college admin.
          </p>
        </div>
      </section>
    </div>
  );
}
