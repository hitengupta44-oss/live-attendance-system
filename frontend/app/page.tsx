"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

export default function Home() {
  const { user, ready } = useAuth();
  const router = useRouter();
  useEffect(() => { if (ready) router.replace(user ? "/dashboard" : "/login"); }, [ready, user, router]);
  return <div className="grid min-h-dvh place-items-center"><div className="skeleton size-10 rounded-full" /></div>;
}
