import { z } from 'zod';

const ClaudeResponseSchema = z.object({
  action: z.enum(['BUY', 'SELL', 'HOLD']),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().min(1),
});

export type ClaudeDecision = z.infer<typeof ClaudeResponseSchema>;

export function parseClaudeResponse(raw: string): ClaudeDecision {
  // strip markdown code blocks if present
  const clean = raw.replace(/```(?:json)?/g, '').replace(/```/g, '').trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(clean);
  } catch {
    throw new Error(`Claude returned invalid JSON: ${raw}`);
  }

  const result = ClaudeResponseSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Claude response failed validation: ${result.error.message}`);
  }

  return result.data;
}
