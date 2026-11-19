// The marker of a runtime root: `<root>/.architect-os-runtime-root`, written once by the installer after it identified
// the volume, never by the entry. Its exact form is two LF-terminated ASCII lines:
//
//   architect-os-runtime-root/v2
//   environment=<name>
//
// It protects against an accidental substitution (a missing volume whose mount path is an ordinary directory, a link);
// it is public data and authenticates nothing against someone who can replace both directory and marker.

export const MARKER_NAME = '.architect-os-runtime-root';
export const MARKER_HEADER = 'architect-os-runtime-root/v2';
const ENVIRONMENT_KEY = 'environment=';
/** No valid marker is longer: the header, the key and the longest name, with their line ends, fit well under it. */
export const MARKER_MAX_BYTES = 256;
const LF = 0x0a;

export type MarkerReading =
  | { readonly kind: 'environment'; readonly name: string }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'no-environment' };

/** A byte of a marker: printable ASCII, or the line end. */
const allowed = (byte: number): boolean => byte === LF || (byte >= 0x20 && byte <= 0x7e);

/**
 * Reads the bytes of a marker. `invalid`: not the exact form (an old or foreign header, a missing final LF, a CR, a
 * byte outside printable ASCII, a second environment line, trailing data). `no-environment`: the header alone, or an
 * empty name. The name is returned as written; whether the policy knows it is the caller's question.
 */
export function readMarker(bytes: Uint8Array): MarkerReading {
  if (bytes.length > MARKER_MAX_BYTES || bytes[bytes.length - 1] !== LF || !bytes.every(allowed)) {
    return { kind: 'invalid' };
  }
  const lines = String.fromCharCode(...bytes.subarray(0, bytes.length - 1)).split('\n');
  if (lines[0] !== MARKER_HEADER || lines.length > 2) return { kind: 'invalid' };
  const line = lines[1];
  if (line === undefined) return { kind: 'no-environment' };
  if (!line.startsWith(ENVIRONMENT_KEY)) return { kind: 'invalid' };
  const name = line.slice(ENVIRONMENT_KEY.length);
  return name === '' ? { kind: 'no-environment' } : { kind: 'environment', name };
}
