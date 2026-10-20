'use client';

import dynamic from 'next/dynamic';

const DrawingsPreview = dynamic(() => import('./DrawingsPreview').then((m) => m.DrawingsPreview), { ssr: false });

export default function Page() {
  return <DrawingsPreview />;
}
