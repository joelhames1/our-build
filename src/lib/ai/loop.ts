import Anthropic from '@anthropic-ai/sdk';
import type { BetaContentBlock, BetaMessageParam, BetaToolResultBlockParam, BetaToolUnion } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { withBrief } from '@/core/ai/brief';
import { inspect } from '@/core/ai/inspect';
import { buildUserMessage } from '@/core/ai/message';
import { SYSTEM_PROMPT } from '@/core/ai/systemPrompt';
import { APPLY_CHANGES, INSPECT, InspectInput } from '@/core/ai/tools';
import type { DesignEvent, DesignRequest, Usage } from '@/core/ai/types';
import type { Issue } from '@/core/model/issues';
import { applyOps } from '@/core/ops/apply';
import { ApplyChangesInput } from '@/core/ops/schema';
import { resolve } from '@/core/resolve';
import { checkRules } from '@/core/rules';
import { designSummary } from '@/core/summary';
import { describeOp } from './describe';

export const MODEL = process.env.OUR_BUILD_MODEL || 'claude-opus-5-5';
const MAX_CALLS = 8;

const TOOLS = [
  { ...APPLY_CHANGES, eager_input_streaming: true },
  { ...INSPECT, strict: false },
] as unknown as BetaToolUnion[];

/**
 * One user turn: a fresh request (system + tools cached), then an append-only tool loop. Every
 * successful batch streams the updated project so the 3D model updates as Claude works.
 */
export async function runDesignTurn(req: DesignRequest, emit: (e: DesignEvent) => void, signal?: AbortSignal): Promise<void> {
  const client = new Anthropic();
  let project = withBrief(req);
  const changes: string[] = [];
  const usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const messages: BetaMessageParam[] = [{ role: 'user', content: buildUserMessage({ ...req, project }, resolve(project)) }];
  let rejectedInARow = 0;
  let reply = '';
  let jsonRetries = 0;

  for (let call = 0; call < MAX_CALLS; call++) {
    const stream = client.beta.messages.stream(
      {
        model: MODEL,
        max_tokens: 32000,
        betas: ['thinking-display-updates-2026-08-18', 'server-side-fallback-2026-07-01'],
        thinking: { type: 'adaptive', display: 'updates' },
        output_config: { effort: req.mode === 'create' ? 'high' : 'medium' },
        fallbacks: 'default',
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral', ttl: '1h' } }],
        tools: TOOLS,
        messages,
      },
      { signal },
    );

    let lastOps = 0;
    stream.on('text', (delta) => emit({ type: 'text', text: delta }));
    stream.on('contentBlock', (block) => {
      if (block.type === 'thinking' && block.thinking.trim()) emit({ type: 'status', text: block.thinking.trim() });
    });
    stream.on('inputJson', (_partial, snapshot) => {
      // Narrate ops as they stream in ("Adding the kitchen…").
      const ops = (snapshot as { ops?: unknown[] } | undefined)?.ops;
      if (!Array.isArray(ops) || ops.length <= lastOps) return;
      const done = ops.slice(lastOps, ops.length - 1);
      lastOps = ops.length - 1;
      for (const o of done) {
        const line = describeOp(o);
        if (line) emit({ type: 'status', text: line });
      }
    });

    let message;
    try {
      message = await stream.finalMessage();
      jsonRetries = 0;
    } catch (err) {
      // With eager input streaming, a tool input that can't be parsed at all rejects here. Retry that once or twice.
      if (err instanceof Anthropic.APIError || jsonRetries++ >= 2) throw err;
      continue;
    }

    usage.input += message.usage.input_tokens;
    usage.output += message.usage.output_tokens;
    usage.cacheRead += message.usage.cache_read_input_tokens ?? 0;
    usage.cacheWrite += message.usage.cache_creation_input_tokens ?? 0;

    if (message.stop_reason === 'refusal') {
      emit({ type: 'error', message: "I couldn't work on that request. Try describing it a little differently?" });
      return;
    }
    if (message.stop_reason === 'max_tokens') {
      emit({ type: 'error', message: 'That change was too big to finish in one go. Try breaking it into smaller steps.' });
      return;
    }

    const content = message.content as BetaContentBlock[];
    messages.push({ role: 'assistant', content: content as BetaMessageParam['content'] });
    const toolUses = content.filter((b): b is Extract<BetaContentBlock, { type: 'tool_use' }> => b.type === 'tool_use');
    const text = content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
    if (text.trim()) reply = text.trim();
    if (!toolUses.length) break;

    const results: BetaToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      if (tu.name === 'inspect') {
        const parsed = InspectInput.safeParse(tu.input);
        results.push(parsed.success ? { type: 'tool_result', tool_use_id: tu.id, content: inspect(resolve(project), parsed.data) } : { type: 'tool_result', tool_use_id: tu.id, is_error: true, content: `Invalid input: ${parsed.error.message}` });
        continue;
      }
      if (tu.name !== 'apply_changes') {
        results.push({ type: 'tool_result', tool_use_id: tu.id, is_error: true, content: `Unknown tool ${tu.name}` });
        continue;
      }
      const parsed = ApplyChangesInput.safeParse(tu.input);
      if (!parsed.success) {
        rejectedInARow++;
        results.push({ type: 'tool_result', tool_use_id: tu.id, is_error: true, content: `The ops didn't match the schema: ${parsed.error.issues.slice(0, 6).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}` });
        continue;
      }
      const r = applyOps(project, parsed.data.ops);
      if (!r.ok) {
        rejectedInARow++;
        results.push({ type: 'tool_result', tool_use_id: tu.id, is_error: true, content: `Rejected (nothing changed). Op #${(r.error?.index ?? 0) + 1} (${r.error?.op}): ${r.error?.message}` });
        continue;
      }
      rejectedInARow = 0;
      if (!parsed.data.dryRun) {
        project = r.project;
        changes.push(...r.log);
        emit({ type: 'project', project, log: r.log, renamed: r.renamed });
      }
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: toolResultText([...r.log, ...Object.entries(r.renamed).map(([a, b]) => `(${a} now has the id ${b}.)`)], r.fixes, r.issues, designSummary(resolve(r.project), r.issues), !!parsed.data.dryRun) });
    }
    messages.push({ role: 'user', content: results });
    if (rejectedInARow >= 3) {
      emit({ type: 'error', message: "I couldn't make that change work. I've kept the design as it was." });
      break;
    }
  }

  const res = resolve(project);
  const issues: Issue[] = [...res.issues, ...checkRules(res)];
  emit({ type: 'done', project, reply: reply || (changes.length ? 'Done.' : ''), changes, issues, usage, engine: 'claude' });
}

function toolResultText(log: string[], fixes: string[], issues: Issue[], summary: string, dry: boolean): string {
  const lines = [dry ? 'DRY RUN (not applied).' : 'Applied.'];
  if (log.length) lines.push(`Changes: ${log.join(' ')}`);
  if (fixes.length) lines.push(`Automatic fixes: ${fixes.join(' ')}`);
  const serious = issues.filter((i) => i.severity !== 'tip');
  lines.push(serious.length ? `Issues now: ${serious.map((i) => `[${i.severity}] ${i.message}`).join(' ')}` : 'No issues.');
  lines.push('', summary);
  return lines.join('\n');
}
