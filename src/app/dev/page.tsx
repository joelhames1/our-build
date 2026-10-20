'use client';

import dynamic from 'next/dynamic';

const DevGallery = dynamic(() => import('./DevGallery').then((m) => m.DevGallery), { ssr: false });

export default function DevPage() {
  return <DevGallery />;
}
