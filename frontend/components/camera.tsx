"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Camera, CameraOff, LocateFixed, MapPinOff, RefreshCw, ShieldCheck, X } from "lucide-react";
import { api, type SessionSummary } from "@/lib/api";
import { useToast } from "./toast";
import { Button } from "./ui";

type Geo = { lat: number; lng: number; acc: number } | null;

/**
 * Live-only capture. There is deliberately no file input anywhere: the only way to
 * submit a photo is a frame grabbed from the camera stream, together with a
 * short-lived single-use token the server issued while the camera was open.
 */
export function LiveCamera({ sessionId, onResult }: { sessionId: number; onResult: (s: SessionSummary) => void }) {
  const toast = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const tokenRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const geoWatch = useRef<number | null>(null);
  const [live, setLive] = useState(false);
  const [opening, setOpening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [frozen, setFrozen] = useState<string | null>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [geo, setGeo] = useState<Geo>(null);
  const [geoErr, setGeoErr] = useState<string | null>(null);
  const [secure, setSecure] = useState(true);

  useEffect(() => { setSecure(window.isSecureContext && !!navigator.mediaDevices?.getUserMedia); }, []);

  const newToken = useCallback(async () => {
    const t = await api<{ token: string; expires_in: number }>(`/api/sessions/${sessionId}/capture-token`, { method: "POST" });
    tokenRef.current = t.token;
    return t;
  }, [sessionId]);

  const stop = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    tokenRef.current = null;
    setLive(false);
  }, []);

  // location: watched for the whole time this panel is on screen
  useEffect(() => {
    if (!("geolocation" in navigator)) { setGeoErr("Location not supported"); return; }
    geoWatch.current = navigator.geolocation.watchPosition(
      (p) => { setGeo({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }); setGeoErr(null); },
      (e) => setGeoErr(e.code === 1 ? "Location blocked" : "Finding location…"),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 });
    return () => { if (geoWatch.current != null) navigator.geolocation.clearWatch(geoWatch.current); };
  }, []);

  useEffect(() => stop, [stop]); // release camera on unmount

  async function open(mode = facing) {
    setOpening(true);
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: mode }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false,
      });
      streamRef.current = stream;
      setLive(true);
      requestAnimationFrame(() => {
        if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play().catch(() => {}); }
      });
      const t = await newToken();
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => { newToken().catch(() => {}); }, Math.max(15, t.expires_in - 20) * 1000);
    } catch (e) {
      const err = e as Error;
      toast(err.name === "NotAllowedError" ? "Camera permission was denied. Allow it in the browser settings." : `Camera: ${err.message}`, "err");
      stop();
    } finally { setOpening(false); }
  }

  async function capture() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) { toast("Camera is still starting…", "err"); return; }
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth; canvas.height = v.videoHeight;
    canvas.getContext("2d")!.drawImage(v, 0, 0);
    setFrozen(canvas.toDataURL("image/jpeg", 0.6));
    setBusy(true);
    try {
      const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Capture failed"))), "image/jpeg", 0.92));
      const fd = new FormData();
      fd.append("image", blob, "live.jpg");
      fd.append("capture_token", tokenRef.current ?? "");
      if (geo) { fd.append("lat", String(geo.lat)); fd.append("lng", String(geo.lng)); fd.append("accuracy", String(geo.acc)); }
      const r = await api<SessionSummary>(`/api/sessions/${sessionId}/photos`, { body: fd });
      const lp = r.last_photo!;
      toast(`${lp.faces} face${lp.faces === 1 ? "" : "s"} found · ${lp.matched} recognised${lp.review ? ` · ${lp.review} to confirm` : ""}${lp.unknown ? ` · ${lp.unknown} unknown` : ""}`);
      onResult(r);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
      setFrozen(null);
      if (streamRef.current) newToken().catch(() => {}); // every capture needs a fresh token
    }
  }

  const geoChip = geo
    ? <span className={clsx("flex items-center gap-1.5", geo.acc > 200 && "text-[#fbbf24]")}><LocateFixed className="size-3.5" />±{Math.round(geo.acc)} m</span>
    : <span className="flex items-center gap-1.5 text-[#fbbf24]"><MapPinOff className="size-3.5" />{geoErr ?? "Finding location…"}</span>;

  return (
    <div className="viewfinder relative aspect-[4/3] w-full overflow-hidden rounded-3xl bg-[#07080a] text-white shadow-card sm:aspect-video">
      <div className="vf-b" />
      {live && <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 size-full object-cover" />}
      {frozen && <img src={frozen} alt="" className="absolute inset-0 z-[2] size-full object-cover" />}
      {busy && <>
        <div className="scanline" />
        <div className="absolute inset-0 z-[3] bg-[#3d3df5]/10" />
        <div className="absolute inset-x-0 bottom-24 z-[5] text-center text-sm font-medium drop-shadow">Matching faces to the class list…</div>
      </>}

      {!live && (
        <div className="absolute inset-0 z-[1] flex flex-col items-center justify-center gap-4 px-8 pt-10 text-center"
          style={{ backgroundImage: "radial-gradient(rgba(255,255,255,.07) 1px, transparent 1px)", backgroundSize: "18px 18px" }}>
          {secure ? <>
            <div className="grid size-16 place-items-center rounded-full bg-white/10"><Camera className="size-7" /></div>
            <div>
              <div className="font-display text-[28px] leading-tight">Ready when the class is.</div>
              <p className="mx-auto mt-1 max-w-xs text-sm text-white/60">Only live camera photos are accepted. Gallery uploads are disabled.</p>
            </div>
            <Button variant="primary" size="lg" loading={opening} onClick={() => open()}><Camera className="size-4" /> Open camera</Button>
          </> : <>
            <CameraOff className="size-8 text-white/60" />
            <p className="max-w-xs text-sm text-white/70">The camera needs a secure (https) connection. Open SmartAttend from its https:// address.</p>
          </>}
        </div>
      )}

      {/* top status chips */}
      <div className="absolute inset-x-0 top-0 z-[6] flex items-center justify-between gap-2 p-4 pl-14 pr-14 text-[11px] font-medium">
        {live ? <span className="flex items-center gap-1.5 rounded-full bg-black/50 px-2.5 py-1 backdrop-blur"><span className="live-dot size-2 rounded-full bg-[#ff4d4d]" />LIVE</span> : <span />}
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-black/50 px-2.5 py-1 backdrop-blur">{geoChip}</span>
          {live && <span className="hidden items-center gap-1.5 rounded-full bg-black/50 px-2.5 py-1 backdrop-blur sm:flex"><ShieldCheck className="size-3.5 text-[#6ee7b7]" />Secured</span>}
        </div>
      </div>

      {/* shutter row */}
      {live && (
        <div className="absolute inset-x-0 bottom-0 z-[6] flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent px-6 pb-5 pt-12">
          <button onClick={stop} aria-label="Close camera" className="grid size-11 place-items-center rounded-full bg-white/15 backdrop-blur transition hover:bg-white/25"><X className="size-5" /></button>
          <button onClick={capture} disabled={busy} aria-label="Capture and mark attendance"
            className="group grid size-[74px] place-items-center rounded-full border-[3px] border-white/90 transition active:scale-95 disabled:opacity-60">
            <span className={clsx("size-[58px] rounded-full bg-white transition group-hover:scale-95", busy && "animate-pulse bg-white/60")} />
          </button>
          <button onClick={() => { const f = facing === "environment" ? "user" : "environment"; setFacing(f); open(f); }} aria-label="Switch camera"
            className="grid size-11 place-items-center rounded-full bg-white/15 backdrop-blur transition hover:bg-white/25"><RefreshCw className="size-5" /></button>
        </div>
      )}
    </div>
  );
}
