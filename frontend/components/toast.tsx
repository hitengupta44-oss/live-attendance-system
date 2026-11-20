"use client";
import { createContext, useCallback, useContext, useState } from "react";
import { CheckCircle2, AlertCircle, X } from "lucide-react";
import clsx from "clsx";

type Toast = { id: number; msg: string; kind: "ok" | "err" };
const Ctx = createContext<(msg: string, kind?: "ok" | "err") => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((msg: string, kind: "ok" | "err" = "ok") => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs.slice(-2), { id, msg, kind }]);
    setTimeout(() => setItems((xs) => xs.filter((t) => t.id !== id)), kind === "err" ? 7000 : 3500);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6">
        {items.map((t) => (
          <div key={t.id} role="status"
            className={clsx("rise pointer-events-auto flex max-w-md items-start gap-3 rounded-xl px-4 py-3 text-sm shadow-card",
              t.kind === "ok" ? "bg-ink text-bg" : "bg-absent text-white")}>
            {t.kind === "ok" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <AlertCircle className="mt-0.5 size-4 shrink-0" />}
            <span className="flex-1">{t.msg}</span>
            <button aria-label="Dismiss" onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))} className="opacity-70 hover:opacity-100">
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
