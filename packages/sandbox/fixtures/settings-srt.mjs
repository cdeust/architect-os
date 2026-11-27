// Faux srt pour les tests : rend au canari le verdict d'une isolation qui tient, et pour toute autre commande imprime
// les réglages qu'il a reçus par `--settings`, sans rien lancer. Il sert à lire ce que l'adaptateur donne à srt.
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const argv = args.slice(args.indexOf('--') + 1);
if (argv.some((arg) => arg.endsWith('canary-probe.mjs'))) {
  process.stdout.write(`${JSON.stringify({ read: 'denied', connect: 'denied' })}\n`);
} else {
  process.stdout.write(readFileSync(args[args.indexOf('--settings') + 1], 'utf8'));
}
