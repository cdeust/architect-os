/** The operator's digest of the producer bundle: lowercase hexadecimal SHA-256, given on every command line. */
export const isBundleDigest = (text: string | undefined): text is string =>
  /^[a-f0-9]{64}$/.test(String(text));
