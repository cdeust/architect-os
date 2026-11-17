import type { Reason } from './ports.js';

/**
 * Why an address may not be read: not HTTPS, a credential or a port, or a host outside the closed list of the four
 * hosts the tool reads (docs/design/anthropic-watch.md §5, S): code, not data.
 */
export function refusal(address: string): Reason | undefined {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return 'hôte hors liste';
  }
  if (url.protocol !== 'https:') return 'protocole refusé';
  if (url.username !== '' || url.password !== '' || url.port !== '') return 'hôte hors liste';
  const hosts = ['raw.githubusercontent.com', 'registry.npmjs.org', 'code.claude.com', 'platform.claude.com'];
  return hosts.includes(url.hostname) ? undefined : 'hôte hors liste';
}
