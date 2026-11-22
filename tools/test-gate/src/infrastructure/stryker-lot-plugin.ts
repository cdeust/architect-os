import { declareFactoryPlugin, PluginKind } from '@stryker-mutator/api/plugin';
import { readFileSync } from 'node:fs';
import { gateReportPath } from './report-paths.js';
import { inventoryIgnorer } from './mutation-lot-ignorer.js';

export function readNativeLotIgnorer(root: string, manifest: string) {
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const text = decoder.decode(readFileSync(manifest));
  return inventoryIgnorer(root, JSON.parse(text).lots);
}

export const strykerPlugins = [
  declareFactoryPlugin(PluginKind.Ignore, 'gate-native-lots', () =>
    readNativeLotIgnorer(process.cwd(), gateReportPath(process.env, 'reports/mutation-inventory.json')),
  ),
];
