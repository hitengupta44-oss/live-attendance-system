"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import clsx from "clsx";
import { BarChart3, BookOpen, GraduationCap, LayoutGrid, LogOut, Users } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Avatar } from "./ui";
import { Wordmark } from "./logo";

const NAV = [
  { href: "/dashboard", label: "Lectures", short: "Lectures", icon: LayoutGrid, admin: false },
  { href: "/reports", label: "Reports", short: "Reports", icon: BarChart3, admin: false },
  { href: "/students", label: "Students", short: "Students", icon: GraduationCap, admin: true },
  { href: "/subjects", label: "Subjects", short: "Subjects", icon: BookOpen, admin: true },
  { href: "/teachers", label: "Staff", short: "Staff", icon: Users, admin: true },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, ready, logout } = useAuth();
  const router = useRouter();
  const path = usePathname();

  useEffect(() => { if (ready && !user) router.replace("/login"); }, [ready, user, router]);

  if (!ready || !user) {
    return <div className="grid min-h-dvh place-items-center"><div className="skeleton size-10 rounded-full" /></div>;
  }
  const items = NAV.filter((n) => !n.admin || user.role === "admin");
  const active = (href: string) => path === href || path.startsWith(href + "/") || (href === "/dashboard" && path.startsWith("/lecture"));

  return (
    <div className="min-h-dvh md:pl-[248px]">
      {/* desktop rail */}
      <aside className="fixed inset-y-0 left-0 hidden w-[248px] flex-col bg-rail px-4 py-5 md:flex">
        <Link href="/dashboard" className="px-2"><Wordmark light /></Link>
        <nav className="mt-8 flex flex-col gap-1">
          {items.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href}
              className={clsx("group flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition",
                active(href) ? "bg-white/10 text-white" : "text-rail-muted hover:bg-white/5 hover:text-rail-ink")}>
              <Icon className={clsx("size-[18px]", active(href) ? "text-[#a5a5ff]" : "")} />
              {label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto rounded-2xl bg-white/5 p-3">
          <div className="flex items-center gap-3">
            <Avatar name={user.full_name} seed={user.email} size={34} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-rail-ink">{user.full_name}</div>
              <div className="text-xs capitalize text-rail-muted">{user.role}</div>
            </div>
            <button onClick={logout} aria-label="Log out" title="Log out" className="rounded-lg p-2 text-rail-muted hover:bg-white/10 hover:text-white">
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* mobile top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-bg/85 px-4 backdrop-blur md:hidden">
        <Link href="/dashboard"><Wordmark /></Link>
        <button onClick={logout} className="flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-xs text-muted hover:bg-surface-2" aria-label="Log out">
          <Avatar name={user.full_name} seed={user.email} size={28} /> Log out
        </button>
      </header>

      <main className="mx-auto w-full max-w-[1180px] px-4 pb-28 pt-6 md:px-8 md:pb-16 md:pt-10">{children}</main>

      {/* mobile tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {items.map(({ href, short, icon: Icon }) => (
          <Link key={href} href={href}
            className={clsx("flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium",
              active(href) ? "text-brand" : "text-muted")}>
            <Icon className="size-5" />{short}
          </Link>
        ))}
      </nav>
    </div>
  );
}
