// Typed client for the SmartAttend backend (FastAPI on Hugging Face).
import { accessToken } from "./supabase";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

export type Role = "admin" | "teacher";
export interface User { id: string; email: string; role: Role; full_name: string }
export interface Subject {
  id: number; code: string; name: string; section: string; teacher_id: string; teacher_name: string;
  room_name: string | null; room_lat: number | null; room_lng: number | null; room_radius_m: number | null;
  student_count: number;
}
export interface Student { roll_no: string; name: string; section: string; face_count: number }
export interface SessionRow {
  id: number; subject_id: number; teacher_id: string; started_at: string; status: "open" | "finalized";
  finalized_at: string | null; present: number; photo_count: number;
}
export type Detected = "matched" | "review" | "not_seen";
export interface RosterEntry {
  roll_no: string; name: string; enrolled_face: boolean; detected: Detected; similarity: number | null;
  final_status: "present" | "absent" | null; final_source: "auto" | "teacher" | null;
}
export interface PhotoInfo {
  id: number; captured_at: string; lat: number | null; lng: number | null; accuracy_m: number | null;
  distance_m: number | null; faces_detected: number; matched: number; review: number; unknown: number;
}
export interface SessionSummary {
  session: { id: number; subject_id: number; started_at: string; status: "open" | "finalized"; teacher_name: string | null };
  subject: Subject;
  photos: PhotoInfo[];
  students: RosterEntry[];
  counts: { total: number; auto_present: number; needs_review: number; not_seen: number };
  last_photo?: { id: number; faces: number; matched: number; review: number; unknown: number };
}
export interface SubjectReport {
  subject: Subject; lectures: number;
  students: { roll_no: string; name: string; attended: number; total: number; percent: number | null }[];
}
export interface StudentReport {
  student: { roll_no: string; name: string; section: string };
  subjects: { code: string; name: string; attended: number; total: number; percent: number | null }[];
}

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) { onUnauthorized = fn; }

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; raw?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = await accessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) body = opts.body;
  else if (opts.body !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(opts.body); }
  let res: Response;
  try {
    res = await fetch(API_URL + path, { method: opts.method || (body ? "POST" : "GET"), headers, body });
  } catch {
    throw new ApiError("Can't reach the server. It may be waking up — try again in a few seconds.", 0);
  }
  if (res.status === 401 && token) onUnauthorized?.();
  if (!res.ok) {
    let msg = res.statusText || "Request failed";
    try {
      const j = await res.json();
      if (typeof j.detail === "string") msg = j.detail;
      else if (Array.isArray(j.detail)) msg = j.detail.map((d: { msg: string }) => d.msg).join("; ");
    } catch { /* not JSON */ }
    throw new ApiError(msg, res.status);
  }
  return (opts.raw ? res : res.json()) as Promise<T>;
}

export async function imageUrl(path: string): Promise<string> {
  const res = await api<Response>(path, { raw: true });
  return URL.createObjectURL(await res.blob());
}
