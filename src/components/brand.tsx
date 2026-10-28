// The Yaxha wordmark: an abstract mortarboard above a quiet two-line logotype.
export function LogoMark({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden fill="none">
      <path d="M16 6 3 12.5 16 19l13-6.5L16 6Z" stroke="#D6B36A" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M8.5 15.5v5.2c0 1.6 3.4 3.3 7.5 3.3s7.5-1.7 7.5-3.3v-5.2" stroke="#D6B36A" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M27 13.5v6" stroke="#D6B36A" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      <span className="flex flex-col leading-none">
        <span className="text-[15px] font-semibold tracking-[0.22em] text-ivory">YAXHA</span>
        {!compact && <span className="mt-1 text-[9px] font-medium tracking-[0.34em] text-gold">ACADEMICS</span>}
      </span>
    </span>
  );
}
