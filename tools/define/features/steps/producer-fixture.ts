import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const sha256 = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');

/** The files of a fixture producer, by path relative to the plugin root. */
export type ProducerFiles = Record<string, string>;

/**
 * One fixture producer for both launch paths: the server source as `mcp-server/index.js`, a package file that makes
 * it CommonJS whatever surrounds the temporary directory, and a skill configuration. Extra files join the tree.
 */
export function producerFiles(server: string, extra: ProducerFiles = {}): ProducerFiles {
  return {
    'mcp-server/index.js': server,
    'mcp-server/package.json': '{"type":"commonjs"}\n',
    'packages/skill/skill-config.json': '{"fixture":true}\n',
    ...extra,
  };
}

export function writeProducer(root: string, files: ProducerFiles): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

/**
 * The digest as the operator computes it without the host: `shasum -a 256` of each pinned file, sorted by the bytes of
 * its path, then the SHA-256 of that listing. Written from the list of files, not from a walk of the tree.
 */
export function expectedDigest(files: ProducerFiles): string {
  const paths = Object.keys(files).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  return sha256(paths.map((path) => `${sha256(files[path]!)}  ${path}\n`).join(''));
}
