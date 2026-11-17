// The strict zod schema of the register `tools/watch/watch.json` (docs/design/anthropic-watch.md §2). zod lives in
// infrastructure, like in the other tools: the domain holds the types and the port `ParseRegister`.
import { z } from 'zod';
import { refusal } from '../domain/hosts.js';
import { isVersion, type ParseRegister, type Register } from '../domain/register.js';

function registerSchema(): z.ZodType<Register> {
  const id = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);
  const version = z.string().refine(isVersion, 'a version is x.y.z');
  const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
  const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
  const path = z
    .string()
    .min(1)
    .refine(
      (value) => !value.startsWith('/') && !value.includes('\\') && !value.split('/').includes('..'),
      'a repository path is relative and has no .. segment',
    );
  const paths = z.array(path).min(1);
  const url = z
    .string()
    .refine((value) => refusal(value) === undefined, 'an address is https: on a host of the closed list');
  const packageName = z.string().regex(/^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/);

  const Pin = z.strictObject({ id, kind: z.literal('pin'), package: packageName, manifests: paths });
  const Changelog = z.strictObject({
    id,
    kind: z.literal('changelog'),
    url,
    read: z.strictObject({ version, on: day }).optional(),
  });
  const Page = z.strictObject({
    id,
    kind: z.literal('page'),
    url,
    mechanisms: paths,
    relies: z.string().min(1),
    read: z.strictObject({ sha256, on: day }).optional(),
  });
  const Index = z.strictObject({ id, kind: z.literal('index'), url, pages: path });
  return z.strictObject({ sources: z.array(z.discriminatedUnion('kind', [Pin, Changelog, Page, Index])) });
}

export const parseRegister: ParseRegister = (raw) => {
  const parsed = registerSchema().safeParse(raw);
  if (parsed.success) return { ok: true, register: parsed.data };
  const reason = parsed.error.issues.map((issue) => `$.${issue.path.join('.')} ${issue.message}`).join('; ');
  return { ok: false, reason };
};
