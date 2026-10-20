import { z } from 'zod';
import type { DesignEvent } from '@/core/ai/types';
import { Project } from '@/core/model/schema';
import { runDesignTurn } from '@/lib/ai/loop';
import { runMockTurn } from '@/lib/ai/mock';
import { authorize } from '@/lib/server/auth';
import { engineMode } from '@/lib/server/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const Body = z.object({
  project: Project,
  request: z.string().min(1).max(4000),
  source: z.enum(['typed', 'voice', 'suggestion']).default('typed'),
  mode: z.enum(['create', 'edit']).default('edit'),
  selection: z
    .object({ kind: z.enum(['room', 'opening', 'fixture', 'stairs', 'wall', 'roof', 'level', 'standing']), id: z.string(), label: z.string(), detail: z.string().optional() })
    .nullable()
    .optional(),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(4000), changes: z.string().max(4000).optional() })).max(20).optional(),
});

export async function POST(req: Request) {
  const auth = await authorize(req);
  if (!auth.ok) return Response.json({ error: auth.message }, { status: auth.status });

  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > 2_000_000) return Response.json({ error: 'Request too large.' }, { status: 413 });
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return Response.json({ error: `Bad request: ${e instanceof Error ? e.message.slice(0, 300) : 'invalid'}` }, { status: 400 });
  }

  const mode = engineMode();
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: DesignEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      try {
        if (mode === 'claude') await runDesignTurn(body, emit, req.signal);
        else await runMockTurn(body, emit);
      } catch (err) {
        console.error('design turn failed', err);
        emit({ type: 'error', message: friendlyError(err) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Engine': mode },
  });
}

export async function GET() {
  return Response.json({ engine: engineMode() });
}

function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/rate|429|overloaded|529/i.test(msg)) return 'The design assistant is busy right now. Give it a moment and try again.';
  if (/401|authentication|api key/i.test(msg)) return "The design assistant isn't set up correctly (API key). Check the setup guide.";
  if (/abort/i.test(msg)) return 'Stopped.';
  return 'Something went wrong while designing. Your house is safe; try again?';
}
