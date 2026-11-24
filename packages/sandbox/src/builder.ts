import { measureSession, type SessionMeasure } from './measure.js';
import type { StepFile } from './step-file.js';

export type ToolFile = 'code.json' | 'review.json' | 'scout.json';

/** Une session de l'outil : son code de sortie, et si la limite l'a arrêtée. `onOutput` reçoit sa sortie au fil de l'eau. */
export type StepSession = (
  tool: ToolFile,
  argv: readonly string[],
  brief: string,
  limitSeconds: number,
  onOutput: (chunk: Uint8Array) => void,
) => Promise<{ exitCode: number; stopped: boolean }>;

export interface BuildRequest {
  readonly config: StepFile['build'];
  readonly worktree: string;
  readonly systemPrompt: string;
  readonly brief: string;
  readonly maxBytes: number;
  readonly onOutput: (chunk: Uint8Array) => void;
}

export interface BuildOutcome {
  readonly provider: 'anthropic' | 'openai';
  readonly exitCode: number;
  readonly stopped: boolean;
  readonly measure: SessionMeasure;
  readonly client?: { version: string; sha256: string };
  readonly receipts?: readonly import('./responses-proxy.js').ResponseReceipt[];
}

export interface Builder {
  build(request: BuildRequest): Promise<BuildOutcome>;
}

/** The admitted SRT launcher appends the frozen system prompt named by code.json. */
export class ClaudeBuilder implements Builder {
  constructor(private readonly launch: StepSession) {}

  async build({ config, brief, maxBytes, onOutput }: BuildRequest): Promise<BuildOutcome> {
    const chunks: Buffer[] = [];
    let bytes = 0;
    const { exitCode, stopped } = await this.launch(
      'code.json',
      [
        '-p',
        '--verbose',
        '--output-format',
        'stream-json',
        '--model',
        config.model,
        '--effort',
        config.effort,
      ],
      brief,
      config.limitSeconds,
      (chunk) => {
        bytes += chunk.byteLength;
        if (bytes <= maxBytes) {
          chunks.push(Buffer.from(chunk));
          onOutput(chunk);
        }
      },
    );
    if (bytes > maxBytes) throw Error('BUILDER_OUTPUT_LIMIT');
    return {
      provider: 'anthropic',
      exitCode,
      stopped,
      measure: measureSession(Buffer.concat(chunks).toString()),
    };
  }
}

export class InMemoryBuilder implements Builder {
  constructor(
    private readonly outcome: BuildOutcome,
    private readonly stream: Uint8Array,
  ) {}

  async build(request: BuildRequest): Promise<BuildOutcome> {
    if (this.stream.byteLength > request.maxBytes) throw Error('BUILDER_OUTPUT_LIMIT');
    request.onOutput(this.stream);
    return this.outcome;
  }
}
