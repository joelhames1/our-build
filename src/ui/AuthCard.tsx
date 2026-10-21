import { Logo } from './Logo';

/** The warm card the sign-in screens sit on. */
export function AuthCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[radial-gradient(900px_500px_at_50%_0%,#fffaf2,transparent),linear-gradient(#f7f4ee,#efe9df)] p-6">
      <div className="w-full max-w-md rounded-[28px] border border-line bg-white/80 p-8 shadow-[0_30px_80px_-40px_rgba(35,33,30,0.5)]">
        <div className="mb-6 flex items-center gap-2.5 text-ink">
          <Logo className="h-8 w-8" />
          <span className="font-serif text-2xl">Our Build</span>
        </div>
        {children}
      </div>
    </div>
  );
}
