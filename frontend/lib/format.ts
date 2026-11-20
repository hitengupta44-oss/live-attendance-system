export function initials(name: string) {
  const p = name.trim().replace(/^(prof|dr|mr|mrs|ms)\.?\s+/i, "").split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}

const HUES = [250, 160, 20, 300, 200, 40, 340, 120, 280, 10];
export function avatarHue(key: string) {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length];
}

export function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}
export function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}
export function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
export function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}
export function pctTone(p: number | null): "present" | "confirm" | "absent" | "muted" {
  if (p == null) return "muted";
  return p >= 75 ? "present" : p >= 60 ? "confirm" : "absent";
}
