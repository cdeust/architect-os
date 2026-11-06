import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import { INTERNAL_TOOLS, INTERNAL_TOOL_NAMES, type Evidence } from '@architect-os/contracts';
import type { AgentEnd, AgentRun, TaskAgent } from '../task-worker.js';

/** The in-process MCP server through which the agent reaches the platform: its tools relay to the gateway. */
const SERVER = 'platform';

/**
 * The tool through which Claude Code gives the output of `outputFormat`. The tools of an agent are an allow-list that
 * removes it too: with `agent` and `tools`, the request upstream carries no StructuredOutput (probed against a local
 * fake upstream, journal §29), so the agent is given it with its own tools.
 */
const STRUCTURED_OUTPUT = 'StructuredOutput';

/** Every record of a JSON array answer carrying a string `id` is evidence; its `content`, when text, the excerpt. */
export function evidenceOf(source: string, text: string): Evidence[] {
  let value: unknown = null;
  try {
    value = JSON.parse(text);
  } catch {
    // Not JSON, a refusal in words: no record, so no evidence.
  }
  return (Array.isArray(value) ? value : [value]).flatMap(
    (item: { id?: unknown; content?: unknown } | null) =>
      typeof item?.id === 'string'
        ? [{ source, ref: item.id, ...(typeof item.content === 'string' ? { excerpt: item.content } : {}) }]
        : [],
  );
}

/**
 * The Agent SDK adapter of the worker of an agent tool (brick 1b.5). The task profile is the main thread: `agent`
 * names it and `agents` gives it, read from agents/<name>.md, its prompt, tools and model (node_modules/@anthropic-ai/
 * claude-agent-sdk/sdk.d.ts, `Options.agent`, `Options.agents`, `AgentDefinition`). Its tools are the internal tools
 * the profile lists, each relayed to the gateway at the address of its data operation. `maxTurns` bounds it; no
 * `maxBudgetUsd` (decision 11). The SDK stopping it at its max_turns (`SDKResultError`, `error_max_turns`) is an end,
 * not an error.
 *
 * The tools of the agent are the floor of what the model is offered: probed against a local fake model (journal §29),
 * with them and `settingSources: []`, neither `strictMcpConfig`, nor `tools: []`, nor `permissionMode` changed what
 * it was offered, a `.mcp.json` in the cwd was not loaded, and a call of Bash, never offered, was refused. Those three
 * options are not set: they would be code without an effect. The sandbox stays the boundary (profile `worker`).
 */
export class SdkTaskAgent implements TaskAgent {
  /**
   * @param env the environment of the Claude Code process; under srt, the one of the profile `worker`.
   * @param executable the Claude Code binary; the one of the SDK when undefined (`pathToClaudeCodeExecutable`).
   */
  constructor(
    private readonly env: Record<string, string | undefined> = process.env,
    private readonly executable?: string,
  ) {}

  async run(run: AgentRun): Promise<AgentEnd> {
    const evidence: Evidence[] = [];
    // Every internal tool is served; the tools of the agent are what the model is offered (its narrowed profile,
    // features/integration/agent-worker.feature).
    const server = createSdkMcpServer({
      name: SERVER,
      tools: INTERNAL_TOOL_NAMES.map((name) =>
        tool(name, INTERNAL_TOOLS[name].description, INTERNAL_TOOLS[name].input.shape, async (args) => {
          const answer = await run.relay(INTERNAL_TOOLS[name].op, args);
          if (!answer.isError) evidence.push(...evidenceOf(INTERNAL_TOOLS[name].owner, answer.text));
          return { content: [{ type: 'text', text: answer.text }], isError: answer.isError };
        }),
      ),
    });
    const { name, description, prompt, tools, model } = run.agent;
    const stream = query({
      prompt: JSON.stringify({ tool: run.tool, input: run.input }),
      options: {
        agent: name,
        agents: { [name]: { description, prompt, tools: [...tools, STRUCTURED_OUTPUT], model } },
        mcpServers: { [SERVER]: server },
        allowedTools: [...tools, STRUCTURED_OUTPUT],
        settingSources: [],
        persistSession: false,
        maxTurns: run.maxTurns,
        outputFormat: { type: 'json_schema', schema: run.outputSchema },
        env: this.env,
        pathToClaudeCodeExecutable: this.executable,
      },
    });
    for await (const message of stream) {
      if (message.type !== 'result') continue;
      const cost = {
        input_tokens: message.usage.input_tokens,
        output_tokens: message.usage.output_tokens,
        usd: message.total_cost_usd,
      };
      if (message.subtype === 'error_max_turns') return { maxTurnsReached: true, cost };
      if (message.subtype !== 'success') throw new Error(`agent stopped: ${message.subtype}`);
      if (message.is_error) throw new Error(`agent failed: ${message.result}`);
      if (message.structured_output === undefined) throw new Error('agent gave no structured output');
      return { structured: message.structured_output, evidence, cost };
    }
    throw new Error('agent produced no result message');
  }
}
