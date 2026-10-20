'use client';

import { Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getRepo } from '@/lib/store/repo';
import type { ProjectMeta } from '@/lib/store/types';
import { AccountBadge } from './AccountBadge';
import { Logo } from './Logo';
import { NewDesign } from './NewDesign';

export function Gallery() {
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null);
  useEffect(() => {
    getRepo()
      .then((r) => r.list())
      .then(setProjects)
      .catch(() => setProjects([]));
  }, []);

  async function remove(p: ProjectMeta) {
    if (!confirm(`Delete "${p.name}"? This can't be undone.`)) return;
    await (await getRepo()).remove(p.id);
    setProjects((ps) => ps?.filter((x) => x.id !== p.id) ?? null);
  }

  return (
    <div className="min-h-dvh bg-[radial-gradient(1200px_600px_at_50%_-10%,#fffaf2,transparent),linear-gradient(#f7f4ee,#efe9df)]">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 pt-6 md:px-8">
        <div className="flex items-center gap-2.5 text-ink">
          <Logo className="h-8 w-8" />
          <span className="font-serif text-2xl tracking-tight">Our Build</span>
        </div>
        <AccountBadge />
      </header>

      <section className="mx-auto flex max-w-6xl flex-col items-center px-5 pb-10 pt-14 text-center md:px-8 md:pt-20">
        <h1 className="max-w-3xl font-serif text-4xl leading-[1.08] tracking-tight text-ink md:text-6xl">What shall we build today?</h1>
        <p className="mt-4 max-w-xl text-base text-ink-2 md:text-lg">Describe it the way you&apos;d tell a friend. We&apos;ll sketch it in 3D, and you can walk through it and reshape it just by talking.</p>
        <div className="mt-8 flex w-full justify-center text-left">
          <NewDesign />
        </div>
      </section>

      {projects && projects.length > 0 && (
        <section className="mx-auto max-w-6xl px-5 pb-20 md:px-8">
          <h2 className="mb-4 font-serif text-2xl text-ink">Your designs</h2>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <div key={p.id} className="group relative overflow-hidden rounded-3xl border border-line bg-white/70 shadow-[0_10px_40px_-25px_rgba(35,33,30,0.5)] transition hover:-translate-y-0.5 hover:shadow-[0_20px_50px_-25px_rgba(35,33,30,0.55)]">
                <Link href={`/p/${p.id}`} className="block">
                  <div className="aspect-[16/10] bg-[linear-gradient(#e9eef1,#dfe4dc)]">
                    {p.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element -- small data-URL thumbnails
                      <img src={p.thumbnail} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-muted"><Logo className="h-12 w-12 opacity-30" /></div>
                    )}
                  </div>
                  <div className="flex items-baseline justify-between px-5 py-4">
                    <div>
                      <div className="font-serif text-xl text-ink">{p.name}</div>
                      <div className="mt-0.5 text-sm text-muted">
                        {p.sqft ? `${p.sqft.toLocaleString('en-US')} sf · ` : ''}
                        {p.levels ? `${p.levels} level${p.levels > 1 ? 's' : ''} · ` : ''}
                        {new Date(p.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </div>
                    </div>
                  </div>
                </Link>
                <button onClick={() => remove(p)} className="absolute right-3 top-3 rounded-full bg-white/80 p-2 text-ink-2 opacity-0 shadow transition group-hover:opacity-100 focus:opacity-100" aria-label={`Delete ${p.name}`}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
