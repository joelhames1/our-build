import type { Resolved } from '../resolve';
import { designSummary } from '../summary';
import type { DesignRequest } from './types';

/** The single user message for one stateless request. */
export function buildUserMessage(req: DesignRequest, res: Resolved): string {
  const parts: string[] = [];
  const empty = req.project.levels.every((l) => l.rooms.length === 0);
  parts.push(`<design>\n${empty ? 'EMPTY: nothing designed yet. Start from a template.' : designSummary(res)}\n</design>`);
  const history = (req.history ?? []).slice(-10);
  if (history.length) {
    parts.push(
      `<recent_conversation>\n${history
        .map((t) => `${t.role === 'user' ? 'Her' : 'You'}: ${t.text}${t.changes ? `\n  (changed: ${t.changes})` : ''}`)
        .join('\n')}\n</recent_conversation>`,
    );
  }
  if (req.selection) {
    const s = req.selection;
    parts.push(`<selection>\n${s.kind === 'standing' ? 'She is standing in' : 'She tapped'} ${s.kind === 'standing' ? '' : `${s.kind} `}${s.id} "${s.label}"${s.detail ? ` (${s.detail})` : ''}\n</selection>`);
  }
  const src = req.source === 'voice' ? ' source="voice (may contain transcription errors)"' : req.source === 'suggestion' ? ' source="tapped a suggestion"' : '';
  parts.push(`<request${src}>\n${req.request.trim()}\n</request>`);
  return parts.join('\n\n');
}
