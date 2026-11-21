import { declareFactoryPlugin, PluginKind } from '@stryker-mutator/api/plugin';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inventoryIgnorer } from './mutation-lot-ignorer.js';

export function readNativeLotIgnorer(root = process.cwd()) {
  const text = readFileSync(resolve(root, 'reports/mutation-inventory.json'), 'utf8');
  return inventoryIgnorer(root, JSON.parse(text).lots);
}

export const strykerPlugins = [
  declareFactoryPlugin(PluginKind.Ignore, 'gate-native-lots', () => readNativeLotIgnorer()),
];
