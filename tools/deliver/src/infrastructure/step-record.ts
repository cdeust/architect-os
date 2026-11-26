// The Step record read by the delivery (docs/design/exigences-spec.md, §4): the text the commit holds, checked by the
// one schema of the record, the one its writer checks it with (packages/sandbox/src/step-record.ts).
import { stepRecordSchema } from '@architect-os/sandbox/step-record';
import type { ParseRecord } from '../domain/pull-request.js';

export const parseStepRecord: ParseRecord = (text) => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // Not JSON: nothing was parsed, and the schema below refuses `undefined`.
  }
  const parsed = stepRecordSchema().safeParse(raw);
  return parsed.success ? parsed.data : undefined;
};
