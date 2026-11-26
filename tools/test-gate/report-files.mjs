// Actions follows links when uploading a directory. Give it the completed, physically checked run tree.
import { appendFileSync, lstatSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { gateReportPath, gateReportsDirectory } from './src/infrastructure/report-paths.ts';
const [command, ...args] = process.argv.slice(2);
if (command === 'path' && args.length === 1) {
  console.log(gateReportPath(process.env, args[0]));
} else if (command === 'clean' && args.length === 0) {
  const names = [
    'cucumber.ndjson',
    'mutation',
    'replay',
    'gate-plan.json',
    'mutation-lanes.json',
    'gate-report.md',
    'gate-base.json',
  ];
  const paths = names.map((name) => gateReportPath(process.env, 'reports/' + name));
  for (const path of paths) rmSync(path, { recursive: true, force: true });
} else if (command === 'announce' && args.length === 0) {
  // The plan job gives its matrix the lanes `hosted-gate lanes` wrote. A hint: the judge derives its own plan.
  const lanes = readFileSync(gateReportPath(process.env, 'reports/mutation-lanes.json'), 'utf8');
  if (!/^\[[1-9][0-9]{0,2}(,[1-9][0-9]{0,2})*\]\n$/.test(lanes)) throw new Error('GATE_LANES_INVALID');
  appendFileSync(process.env.GITHUB_OUTPUT, 'lanes=' + lanes);
} else if (command === 'publish' && args.length === 0) {
  const root = gateReportsDirectory(process.env);
  const device = lstatSync(root, { bigint: true }).dev;
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop();
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      const node = lstatSync(path, { bigint: true });
      if (node.dev !== device || !(node.isDirectory() || (node.isFile() && node.nlink === 1n)))
        throw new Error('GATE_REPORT_PATH_INVALID');
      if (node.isDirectory()) pending.push(path);
    }
  }
  appendFileSync(process.env.GITHUB_OUTPUT, 'reports=' + root + '\n');
} else throw new Error('expected path reports/<name> or clean or announce or publish');
