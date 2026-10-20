import { AuthGate } from '@/ui/AuthGate';
import { Gallery } from '@/ui/Gallery';

export default function Home() {
  return (
    <AuthGate>
      <Gallery />
    </AuthGate>
  );
}
