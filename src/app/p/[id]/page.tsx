import { Studio } from '@/ui/studio/Studio';

export default async function StudioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Studio id={id} />;
}
