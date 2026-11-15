import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A self-signed certificate for `localhost` and 127.0.0.1, made by openssl in `dir` and valid two days: what a
 * scenario gives a fake HTTPS server, and what it gives a client as its certificate authority (NODE_EXTRA_CA_CERTS).
 * Never a real key: it is made for one scenario and removed with its folder.
 */
export function selfSigned(dir: string): { key: string; cert: string; certFile: string } {
  const config = join(dir, 'openssl.cnf');
  const keyFile = join(dir, 'key.pem');
  const certFile = join(dir, 'cert.pem');
  writeFileSync(
    config,
    [
      '[req]',
      'distinguished_name = dn',
      'x509_extensions = v3',
      'prompt = no',
      '[dn]',
      'CN = localhost',
      '[v3]',
      'subjectAltName = DNS:localhost, IP:127.0.0.1',
      'basicConstraints = critical, CA:TRUE',
      '',
    ].join('\n'),
  );
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '2',
      '-config',
      config,
      '-keyout',
      keyFile,
      '-out',
      certFile,
    ],
    { stdio: 'pipe' },
  );
  return { key: readFileSync(keyFile, 'utf8'), cert: readFileSync(certFile, 'utf8'), certFile };
}
