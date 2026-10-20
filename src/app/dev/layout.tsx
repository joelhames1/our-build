import { notFound } from 'next/navigation';

/** Developer previews (model gallery, drawings) stay out of deployed builds unless asked for. */
export default function DevLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === 'production' && process.env.OUR_BUILD_DEV_PAGES !== '1') notFound();
  return children;
}
