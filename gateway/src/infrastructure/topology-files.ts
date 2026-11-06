import { readFileSync } from 'node:fs';
import { TopologySchema, type Topology } from '@architect-os/contracts';

/** The three files of the topology: the catalogue of manifest-registry, topology/modules.mcp.json, topology/clients.json. */
export interface TopologyFiles {
  catalog: string;
  servers: string;
  clients: string;
}

/**
 * Reads the three files together and validates them as one (packages/contracts/src/modules.ts, TopologySchema). A file
 * that does not parse, or a topology that breaks a rule, is refused whole: the gateway launches no module and routes
 * nothing (brick 1b.4, manifest.feature).
 */
export function loadTopology(files: TopologyFiles): Topology {
  const read = (path: string): unknown => JSON.parse(String(readFileSync(path)));
  return TopologySchema.parse({
    catalog: read(files.catalog),
    servers: read(files.servers),
    clients: read(files.clients),
  });
}
