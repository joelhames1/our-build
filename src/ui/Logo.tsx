export function Logo({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <path d="M4 15.5 16 5l12 10.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7.5 13v13.5h17V13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M13.5 26.5v-7h5v7" fill="none" stroke="#c0643a" strokeWidth="2.2" strokeLinejoin="round" />
    </svg>
  );
}
