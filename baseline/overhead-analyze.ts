// Analysis of measure A (baseline/README.md, protocol pre-registered): `npm run baseline:overhead-analyze -- <file>`.
// Per configuration, the median, p10 and p90 of the wall time, warm-up measures and failed measures left out (their
// count is reported). For each hypothesis, the difference of medians and its 95 % percentile interval by bootstrap
// (10 000 resamples, seed 42), and its verdict against the threshold written before the measure. Writes <file>.md.
import { readFileSync, writeFileSync } from 'node:fs';

interface Measure {
  config: string;
  warmup: boolean;
  ms: number;
  ok: boolean;
}

const file = process.argv[2];
if (file === undefined) throw new Error('usage: overhead-analyze.ts <results.jsonl>');
const lines = readFileSync(file, 'utf8')
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line) as Record<string, unknown>);
const header = lines.find((line) => line['header'] === true) ?? {};
const measures = lines.filter((line) => line['header'] !== true) as unknown as Measure[];

/** Mulberry32: a seeded generator, so the intervals are the same at every run (as baseline/analyze.ts). */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const quantile = (values: number[], q: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (sorted.length - 1) * q;
  const low = Math.floor(at);
  return sorted[low]! + (sorted[Math.ceil(at)]! - sorted[low]!) * (at - low);
};
const median = (values: number[]) => quantile(values, 0.5);

const kept = (config: string) =>
  measures.filter((m) => m.config === config && !m.warmup && m.ok).map((m) => m.ms);
const failed = (config: string) => measures.filter((m) => m.config === config && !m.warmup && !m.ok).length;

/** Median of `a` minus median of `b`, with its 95 % interval: independent resamples of each group. */
function difference(
  a: number[],
  b: number[],
  next: () => number,
  resamples = 10_000,
): [number, number, number] {
  const draw = (values: number[]) =>
    Array.from({ length: values.length }, () => values[Math.floor(next() * values.length)]!);
  const diffs = Array.from({ length: resamples }, () => median(draw(a)) - median(draw(b)));
  return [median(a) - median(b), quantile(diffs, 0.025), quantile(diffs, 0.975)];
}

const configs = [...new Set(measures.map((m) => m.config))];
const ms = (value: number) => `${Math.round(value)} ms`;
const rows = configs.map((config) => {
  const values = kept(config);
  return `| \`${config}\` | ${values.length} | ${failed(config)} | ${ms(median(values))} | ${ms(quantile(values, 0.1))} | ${ms(quantile(values, 0.9))} |`;
});

const next = random(42);
const overhead = (config: string) => kept(config).map((value) => value);
const [srtStart, srtLow, srtHigh] = difference(overhead('iso-srt'), overhead('iso-none'), next);
const [dockerStart, dockerLow, dockerHigh] = difference(overhead('iso-docker'), overhead('iso-none'), next);
const [h1, h1Low, h1High] = difference(overhead('iso-srt'), overhead('iso-docker'), next);
const [h2, h2Low, h2High] = difference(overhead('recall-srt-warm'), overhead('recall-inproc'), next);
const [h3, h3Low, h3High] = difference(overhead('recall-srt-cold'), overhead('recall-srt-warm'), next);

/** A hypothesis holds when the whole interval is below its threshold, fails when the whole interval is above. */
const verdict = (low: number, high: number, threshold: number) =>
  high < threshold ? 'tient' : low >= threshold ? 'réfutée' : 'indécise (l’intervalle contient le seuil)';

const report = `# Mesure A, surcoût de la structure

Fichier : \`${file}\`. Hôte : ${String(header['os'])}, ${String(header['cpu'])} (${String(header['cpus'])} cœurs), Node ${String(header['node'])}, srt ${String(header['srt'])}, Docker ${String(header['docker'])}, Claude Code ${String(header['claudeCode'])}. ${String(header['n'])} mesures par configuration après ${String(header['warmup'])} de chauffe.

| Configuration | Mesures | Échecs | Médiane | p10 | p90 |
| --- | --- | --- | --- | --- | --- |
${rows.join('\n')}

Écarts de médianes, intervalle à 95 % par bootstrap (10 000 tirages, graine 42) :

| Écart | Valeur | Intervalle | Seuil | Verdict |
| --- | --- | --- | --- | --- |
| démarrage srt − aucun | ${ms(srtStart)} | ${ms(srtLow)} à ${ms(srtHigh)} | | |
| démarrage Docker − aucun | ${ms(dockerStart)} | ${ms(dockerLow)} à ${ms(dockerHigh)} | | |
| H1 : srt − Docker | ${ms(h1)} | ${ms(h1Low)} à ${ms(h1High)} | < 0 ms | ${verdict(h1Low, h1High, 0)} |
| H2 : recall srt chaud − en processus | ${ms(h2)} | ${ms(h2Low)} à ${ms(h2High)} | < 1 000 ms | ${verdict(h2Low, h2High, 1000)} |
| H3 : recall srt froid − chaud | ${ms(h3)} | ${ms(h3Low)} à ${ms(h3High)} | < 1 000 ms | ${verdict(h3Low, h3High, 1000)} |
`;
writeFileSync(`${file.replace(/\.jsonl$/, '')}.md`, report);
process.stdout.write(report);
