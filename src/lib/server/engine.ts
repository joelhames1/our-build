/** Which brain answers: Claude when a key is configured, the rule-based demo otherwise. */
export function engineMode(): 'claude' | 'mock' {
  if (process.env.AI_MODE === 'mock') return 'mock';
  return process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN ? 'claude' : 'mock';
}
