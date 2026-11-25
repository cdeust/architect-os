import { z } from 'zod';

/** The OpenAI models whose pinned native client Step admits (docs/design/orchestration-fable-5-2.md, §13). */
export const codexModelSchema = z.enum(['gpt-6.2-astra', 'gpt-6.2-sol']);
export type CodexModel = z.infer<typeof codexModelSchema>;
