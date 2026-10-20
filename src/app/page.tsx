import Link from 'next/link';

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl p-10">
      <h1 className="font-serif text-5xl">Our Build</h1>
      <p className="mt-4 text-ink-2">Coming together. Peek at the geometry gallery:</p>
      <Link className="mt-6 inline-block rounded-full bg-ink px-5 py-2 text-paper" href="/dev">
        Open dev gallery
      </Link>
    </main>
  );
}
