// Analysis of a baseline campaign: `node --import tsx baseline/analyze.ts baseline/results/campaign-<date>.jsonl`.
// Writes <file>.md beside it. The design is paired: every task runs in every configuration, so the cost ratios are
// computed task by task (mean of the repetitions of a cell) and their 95 % interval comes from a bootstrap over the
// tasks, seeded, hence reproducible. The resolution rate gets a Wilson score interval. Costs are `total_cost_usd`
// of `claude -p --output-format json`, at public prices.
import { readFileSync, writeFileSync } from 'node:fs';

interface Usage {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
}
interface Row {
  task: string;
  config: string;
  rep: number;
  solved: boolean;
  testsTouched: string[];
  costUsd: number | null;
  usage: Usage | null;
  turns: number | null;
  wallMs: number;
  claude: string;
  model: string;
}

const file = process.argv[2];
if (file === undefined) throw new Error('usage: analyze <campaign.jsonl>');
const lines = readFileSync(file, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line) as Record<string, unknown>);
const rows = lines.filter((line) => 'task' in line) as unknown as Row[];
const footer = lines.find((line) => 'remotesUntouched' in line);
const CONFIGS = ['host', 'host-bare', 'srt'];
const tasks = [...new Set(rows.map((row) => row.task))];

const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;
const inputTokens = (u: Usage | null) =>
  (u?.input_tokens ?? 0) + (u?.cache_creation_input_tokens ?? 0) + (u?.cache_read_input_tokens ?? 0);

/** Wilson score interval at 95 % for k successes out of n. */
function wilson(k: number, n: number): [number, number] {
  const z = 1.96;
  const p = k / n;
  const centre = (p + (z * z) / (2 * n)) / (1 + (z * z) / n);
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n);
  return [centre - half, centre + half];
}

/** Mulberry32: a seeded generator, so the bootstrap intervals are the same at every run. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mean of a per-task statistic and its 95 % bootstrap percentile interval over the tasks. */
function bootstrap(values: number[], resamples = 10_000, seed = 20261104): [number, number, number] {
  const next = random(seed);
  const means: number[] = [];
  for (let r = 0; r < resamples; r++) {
    const sample = values.map(() => values[Math.floor(next() * values.length)] as number);
    means.push(mean(sample));
  }
  means.sort((a, b) => a - b);
  return [
    mean(values),
    means[Math.floor(0.025 * resamples)] as number,
    means[Math.floor(0.975 * resamples)] as number,
  ];
}

const cell = (task: string, config: string) =>
  rows.filter((row) => row.task === task && row.config === config);
const cellCost = (task: string, config: string) => mean(cell(task, config).map((row) => row.costUsd ?? 0));

/** French decimals: a comma. */
const fr = (value: number, digits: number) => value.toFixed(digits).replace('.', ',');
const money = (value: number) => `${fr(value, 4)} $`;
const pct = (value: number) => `${fr(value * 100, 1)} %`;
const out: string[] = [];
const sample = rows[0];
out.push(`# Campagne de la baseline de coût`, '');
out.push(
  `${rows.length} sessions, ${tasks.length} tâches, ${CONFIGS.length} configurations, ${Math.max(...rows.map((r) => r.rep ?? 0)) + 1} répétitions ; ${sample?.claude ?? '?'}, modèle ${sample?.model ?? '?'}. Coût : \`total_cost_usd\` au tarif public. Dépôts distants : ${footer?.['remotesUntouched'] === true ? 'aucune branche ni aucun tag changé' : `changements relevés : ${JSON.stringify(footer?.['remoteChanges'])}`}.`,
  '',
);
out.push(
  '| Configuration | Résolues | IC 95 % (Wilson) | Coût moyen par session | Tokens d’entrée moyens | Tokens de sortie moyens | Tours moyens | Durée moyenne |',
);
out.push('|---|---|---|---|---|---|---|---|');
for (const config of CONFIGS) {
  const of = rows.filter((row) => row.config === config);
  const solved = of.filter((row) => row.solved && row.testsTouched.length === 0).length;
  const [low, high] = wilson(solved, of.length);
  out.push(
    `| \`${config}\` | ${solved} / ${of.length} | ${pct(low)} à ${pct(high)} | ${money(mean(of.map((r) => r.costUsd ?? 0)))} | ${Math.round(mean(of.map((r) => inputTokens(r.usage))))} | ${Math.round(mean(of.map((r) => r.usage?.output_tokens ?? 0)))} | ${fr(mean(of.map((r) => r.turns ?? 0)), 1)} | ${fr(mean(of.map((r) => r.wallMs)) / 1000, 1)} s |`,
  );
}
out.push(
  '',
  'Une session compte comme résolue si le contrôle passe après elle et qu’aucun fichier de test n’a été modifié.',
  '',
);
out.push('## Rapports de coût, appariés par tâche', '');
out.push('| Rapport | Moyenne sur les tâches | IC 95 % (bootstrap sur les tâches) |');
out.push('|---|---|---|');
for (const [a, b] of [
  ['host-bare', 'host'],
  ['srt', 'host'],
  ['srt', 'host-bare'],
] as const) {
  const [m, low, high] = bootstrap(tasks.map((task) => cellCost(task, a) / cellCost(task, b)));
  out.push(`| \`${a}\` / \`${b}\` | ${fr(m, 3)} | ${fr(low, 3)} à ${fr(high, 3)} |`);
}
out.push('', '## Par tâche (coût moyen des répétitions)', '');
out.push(`| Tâche | ${CONFIGS.map((c) => `\`${c}\``).join(' | ')} |`);
out.push(`|---|${CONFIGS.map(() => '---').join('|')}|`);
for (const task of tasks) {
  out.push(
    `| ${task} | ${CONFIGS.map((config) => `${money(cellCost(task, config))} (${cell(task, config).filter((r) => r.solved).length}/${cell(task, config).length})`).join(' | ')} |`,
  );
}
writeFileSync(file.replace(/\.jsonl$/, '.md'), `${out.join('\n')}\n`);
process.stdout.write(`${out.join('\n')}\n`);
