// The Step record read by the delivery (docs/design/exigences-spec.md, §4): the text the commit holds, checked by the
// one schema of the record, the one its writer checks it with (packages/sandbox/src/step-record.ts).
import { stepRecordSchema } from '@architect-os/sandbox/step-record';
import type { ParseRecord } from '../domain/pull-request.js';

export const parseStepRecord: ParseRecord = (bytes) => {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    // Not UTF-8, or not JSON: nothing was parsed, and the schema below refuses `undefined`.
  }
  const parsed = stepRecordSchema().safeParse(raw);
  return parsed.success ? parsed.data : undefined;
};
