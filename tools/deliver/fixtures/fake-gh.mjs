// A stand-in for the GitHub client, for the contract of `Forge` and the scenarios of the command (features/steps/gh-fixture.ts).
//   node fake-gh.mjs <answers file> api <arguments...>
// The answers file is a JSON object: the arguments after `api`, joined by a space, to
//   { "exit": <code, 0 when absent>, "stdout": <text>, "then": <answers that replace the same keys once this one is given> }.
// A key that is not there is looked for without its query string. A POST nobody planned is accepted and answers `{}`;
// any other call that nobody planned exits 1 and prints nothing. Each argv received (after the answers file) is appended,
// one line, to `<answers file>.argv`; the names of its environment, sorted and joined by a space, one line, to `<answers file>.env`
// (macOS adds `__CF_USER_TEXT_ENCODING` to every process it starts: it is left out).
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const [file, ...args] = process.argv.slice(2);
appendFileSync(`${file}.path`, `${process.env.PATH}\n`);
appendFileSync(`${file}.argv`, `${args.join(' ')}\n`);
appendFileSync(
  `${file}.env`,
  `${Object.keys(process.env)
    .filter((name) => name !== '__CF_USER_TEXT_ENCODING')
    .sort()
    .join(' ')}\n`,
);
const answers = JSON.parse(readFileSync(file, 'utf8'));
const key = args.slice(1).join(' ');
const planned = answers[key] ?? answers[key.split('?')[0]];
const answer = planned ?? (args.includes('POST') ? { stdout: '{}' } : { exit: 1 });
process.stdout.write(answer.stdout ?? '');
if (answer.then !== undefined) writeFileSync(file, JSON.stringify({ ...answers, ...answer.then }));
process.exitCode = answer.exit ?? 0;
