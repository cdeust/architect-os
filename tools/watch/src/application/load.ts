// Loading the register (docs/design/anthropic-watch.md §3, exit 2): the schema, then what the repository must hold.
import { pinnedVersion, type ParseRegister, type Register } from '../domain/register.js';
import type { Files } from '../domain/ports.js';

export const registerPath = (): string => 'tools/watch/watch.json';

export type Loaded = { ok: true; register: Register } | { ok: false; reason: string };

const unusable = (reason: string): Loaded => ({ ok: false, reason });

export function loadRegister(repository: Files, parse: ParseRegister): Loaded {
  const text = repository.read(registerPath());
  if (text === undefined) return unusable(`${registerPath()} est absent`);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return unusable(`${registerPath()} n'est pas du JSON`);
  }
  const parsed = parse(raw);
  if (!parsed.ok) return unusable(`${registerPath()} hors schéma : ${parsed.reason}`);
  const register = parsed.register;
  const seen = new Set<string>();
  for (const source of register.sources) {
    if (seen.has(source.id)) return unusable(`identifiant en double : ${source.id}`);
    seen.add(source.id);
  }
  for (const source of register.sources) {
    if (source.kind === 'pin') {
      for (const path of source.manifests) {
        if (pinnedVersion(repository.read(path), source.package) === undefined) {
          return unusable(`${source.id} : ${path} n'épingle pas ${source.package} à une version exacte`);
        }
      }
    }
    if (source.kind === 'page') {
      for (const path of source.mechanisms) {
        if (!repository.exists(path)) return unusable(`${source.id} : ${path} est absent du dépôt`);
      }
    }
  }
  return { ok: true, register };
}
