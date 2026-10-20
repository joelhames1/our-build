import { z } from 'zod';
import { ApplyChangesInput } from '../../src/core/ops/schema';
import { SYSTEM_PROMPT } from '../../src/core/ai/systemPrompt';
const js = z.toJSONSchema(ApplyChangesInput, { io: 'input', unrepresentable: 'any' });
const s = JSON.stringify(js);
console.log('schema chars', s.length, 'approx tokens', Math.round(s.length / 3.5));
console.log('system chars', SYSTEM_PROMPT.length, 'approx tokens', Math.round(SYSTEM_PROMPT.length / 4));
console.log(Object.keys(js), JSON.stringify(js).slice(0, 600));
