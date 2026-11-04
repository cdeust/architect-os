import type { Readable } from 'node:stream';
import { SandboxError } from './port.js';

/**
 * Lit un flux jusqu'à sa fin, en UTF-8, au plus `maxBytes` octets (décision 3 : une sortie sans borne faisait tomber
 * l'hôte, 2 Mo donnaient 545 Mo de tas). Au-delà, le flux est détruit et la lecture rejetée par `OUTPUT_TOO_LARGE` ;
 * l'appelant arrête alors la sandbox. Le texte n'est décodé qu'une fois entier : un caractère coupé entre deux
 * morceaux reste juste.
 */
export function readCapped(stream: Readable, maxBytes: number): Promise<string> {
  return new Promise((done, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    stream.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        stream.destroy();
        fail(new SandboxError('OUTPUT_TOO_LARGE', `sortie au-delà de ${maxBytes} octets`));
        return;
      }
      chunks.push(chunk);
    });
    stream.once('end', () => done(Buffer.concat(chunks).toString('utf8')));
    stream.once('error', fail);
  });
}
