export function LogoMark({ size = 32 }: { size?: number }) {
  // viewfinder brackets around a face dot: "the class, captured"
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="9" fill="var(--brand)" />
      <g fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round">
        <path d="M8 12V9.5A1.5 1.5 0 0 1 9.5 8H12" />
        <path d="M20 8h2.5A1.5 1.5 0 0 1 24 9.5V12" />
        <path d="M24 20v2.5a1.5 1.5 0 0 1-1.5 1.5H20" />
        <path d="M12 24H9.5A1.5 1.5 0 0 1 8 22.5V20" />
      </g>
      <circle cx="16" cy="14.2" r="2.6" fill="#fff" />
      <path d="M11.6 21.2c.9-2.1 2.5-3.2 4.4-3.2s3.5 1.1 4.4 3.2" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark({ light }: { light?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      <span className={`text-[17px] font-semibold tracking-tight ${light ? "text-rail-ink" : "text-ink"}`}>
        Smart<span className="font-display text-[20px] font-normal italic">Attend</span>
      </span>
    </span>
  );
}
