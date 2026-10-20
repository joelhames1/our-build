import type { DesignEvent, DesignRequest } from '@/core/ai/types';

/** POST a design request and read the server-sent events as they arrive. */
export async function streamDesign(body: DesignRequest, onEvent: (e: DesignEvent) => void, opts: { signal?: AbortSignal; token?: string | null } = {}): Promise<void> {
  const res = await fetch('/api/design', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    let message =
      res.status === 504 || res.status === 502
        ? 'The design assistant took too long to answer. Try again, or ask for a smaller change.'
        : res.status >= 500
          ? 'Something went wrong on the server. Your design is safe; try again in a moment?'
          : `The design service answered ${res.status}.`;
    try {
      message = ((await res.json()) as { error?: string }).error ?? message;
    } catch {
      // not JSON (a proxy or platform error page): keep the message above
    }
    onEvent({ type: 'error', message });
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const line = chunk.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice(6)) as DesignEvent);
      } catch {
        // ignore a malformed event
      }
    }
  }
}
