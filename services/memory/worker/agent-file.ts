import { AgentFileSchema, type AgentFile } from '@architect-os/contracts';
import { parse } from 'yaml';

/** A task profile (agents/<name>.md): its frontmatter and, as its system prompt, the body of the file. */
export interface AgentProfile extends AgentFile {
  readonly prompt: string;
}

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n([\s\S]*)/;

/**
 * Reads a task profile in the format of Claude Code (docs/design/platform-v3-srt.md, §4, Profils de task): a YAML
 * frontmatter between two `---` lines, checked against AgentFileSchema, then the system prompt. Refused whole: a file
 * without frontmatter, a frontmatter outside its schema, or an empty prompt.
 */
export function parseAgentFile(text: string): AgentProfile {
  const match = FRONTMATTER.exec(text);
  if (match === null) throw new Error('an agent file starts with its frontmatter between two --- lines');
  const frontmatter = AgentFileSchema.parse(parse(match[1]!));
  const prompt = match[2]!.trim();
  if (prompt === '') throw new Error(`the agent ${frontmatter.name} has no prompt`);
  return { ...frontmatter, prompt };
}
