#!/usr/bin/env node
// Attend le prochain verdict du guichet sans relire périodiquement : le système de fichiers prévient quand une fiche
// vérifiée arrive au registre (verified/<id>.json) ou quand un refus est écrit pour le répondant (out/<id>.rejected.json).
// Affiche une ligne JSON {id, verdict} et se termine : dans Claude Code, la fin d'une tâche de fond réveille la session.
// Usage : node wait-verdict.mjs <registre> <guichet>
import { readdirSync, watch } from 'node:fs';
import { join } from 'node:path';

const [ledger, desk] = process.argv.slice(2);
const verified = join(ledger, 'verified');
const out = join(desk, 'out');
const known = new Set(readdirSync(verified));
const done = (id, verdict) => {
  process.stdout.write(`${JSON.stringify({ id, verdict, at: new Date().toISOString() })}\n`);
  process.exit(0);
};
watch(verified, (_event, name) => {
  if (name?.endsWith('.json') && !known.has(name) && readdirSync(verified).includes(name)) done(name.slice(0, -5), 'verified');
});
watch(out, (_event, name) => {
  if (name?.endsWith('.rejected.json') && readdirSync(out).includes(name)) done(name.slice(0, -14), 'rejected');
});
