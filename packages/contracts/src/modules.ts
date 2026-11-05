import { z } from 'zod';

/**
 * The modules of the platform as the gateway reads them (docs/design/platform-v3-srt.md, §5, Manifeste de module, and
 * brick 1b.4): a manifest per module, the catalogue that `manifest-registry` writes from them, the `.mcp.json` that says
 * how each module is launched, and the profiles of the clients. Each rule is one line of a schema and one row of
 * features/descriptive/manifest.feature. A rule across fields is `ctx.addIssue(message)`, a custom issue
 * (node_modules/zod/v4/core/api.d.ts:310 and core/util.js, `issue`).
 */

/** A module: lowercase, digits and dashes, as a directory of modules/ is named. */
export const ModuleNameSchema = z.string().regex(/^[a-z][a-z0-9-]{0,62}$/);
/** A table of the registry, schema-qualified when not in `public`, as DATA_OPS.writes names it. */
const TableNameSchema = z.string().regex(/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/);
const ToolNameSchema = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/);
const Positive = z.number().int().positive();

export const ModuleToolSchema = z
  .strictObject({
    name: ToolNameSchema,
    description: z.string().min(1),
    input_schema: z.string().regex(/^\.\/[\w./-]+\.json$/),
    output_schema: z
      .string()
      .regex(/^\.\/[\w./-]+\.json$/)
      .optional(),
    /** data | workflow when the behaviour is stable; agent otherwise. */
    kind: z.enum(['data', 'workflow', 'agent']),
    /** Declares the behaviour stable: then it is data or workflow, never agent. */
    stable: z.boolean().default(false),
    max_result_tokens: Positive.max(100_000),
    validator: z.enum(['schema', 'verify', 'spec-lint', 'citations', 'none']),
    annotations: z.strictObject({ readOnlyHint: z.boolean().optional() }).optional(),
  })
  .refine((tool) => !(tool.kind === 'agent' && tool.stable), {
    message: 'a tool of kind agent cannot be marked stable',
  });

export const ModuleAgentSchema = z.strictObject({
  profile: z.string().regex(/^[a-z][a-z0-9-]*$/),
  model_min: z.enum(['haiku', 'sonnet', 'opus']),
  max_turns: Positive.max(200),
  timeout_ms: Positive,
});

export const ModuleManifestSchema = z
  .strictObject({
    name: ModuleNameSchema,
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    domain: z.string().regex(/^[a-z][a-z0-9-]*$/),
    owner: z.string().min(1),
    tools: z.array(ModuleToolSchema).min(1),
    agent: ModuleAgentSchema.nullable(),
    /** none, or the domains it may reach; any egress writes to quarantine. */
    egress: z.union([z.literal('none'), z.array(z.string().min(1)).min(1)]),
    writes_tables: z.array(TableNameSchema),
    reads_domains: z.array(z.string().min(1)),
    calls_allowed: z.array(ModuleNameSchema),
    /** The deadline of a call to it: the shortest of this and the deadline of its parent wins. */
    timeout_ms: Positive.max(3_600_000),
  })
  .superRefine((manifest, ctx) => {
    const agentic = manifest.tools.some((tool) => tool.kind === 'agent');
    if (agentic && manifest.agent === null) ctx.addIssue('a tool of kind agent needs the agent block');
    if (!agentic && manifest.agent !== null) ctx.addIssue('the agent block without a tool of kind agent');
    if (manifest.calls_allowed.includes(manifest.name)) ctx.addIssue(`${manifest.name} calls itself`);
    const names = manifest.tools.map((tool) => tool.name);
    if (new Set(names).size !== names.length) ctx.addIssue('two tools of one name');
  });
export type ModuleManifest = z.infer<typeof ModuleManifestSchema>;

/**
 * The first cycle of `calls_allowed`, as the list of modules it goes through, or null. The modules that reach no cycle
 * are removed until none is left to remove; each module left calls another module left, so following the first such
 * call from the first module left closes a cycle.
 */
function callCycle(modules: readonly Pick<ModuleManifest, 'name' | 'calls_allowed'>[]): string[] | null {
  const left = new Map(modules.map((module) => [module.name, module.calls_allowed]));
  let removed = true;
  while (removed) {
    removed = false;
    for (const [name, callees] of left) {
      if (!callees.some((callee) => left.has(callee))) removed = left.delete(name);
    }
  }
  if (left.size === 0) return null;
  const path = [...left.keys()].slice(0, 1);
  for (;;) {
    const next = left.get(path[path.length - 1]!)!.find((callee) => left.has(callee))!;
    if (path.includes(next)) return [...path.slice(path.indexOf(next)), next];
    path.push(next);
  }
}

/**
 * The catalogue `manifest-registry` writes from the manifests: the only form of them the gateway reads. A catalogue
 * that breaks a rule across modules is refused whole, and none of its modules is routed.
 */
export const ModuleCatalogSchema = z
  .strictObject({ modules: z.array(ModuleManifestSchema) })
  .superRefine(({ modules }, ctx) => {
    const names = modules.map((module) => module.name);
    if (new Set(names).size !== names.length) ctx.addIssue('two modules of one name');
    const known = new Set(names);
    for (const module of modules) {
      for (const callee of module.calls_allowed) {
        if (!known.has(callee)) ctx.addIssue(`${module.name} may call ${callee}, which is not a module`);
      }
    }
    const cycle = callCycle(modules);
    if (cycle !== null) ctx.addIssue(`calls_allowed cycle: ${cycle.join(' -> ')}`);
    const writers = new Map<string, string>();
    for (const module of modules) {
      for (const table of module.writes_tables) {
        const other = writers.get(table);
        if (other !== undefined) ctx.addIssue(`${table} is written by ${other} and ${module.name}`);
        writers.set(table, module.name);
      }
    }
    const tools = modules.flatMap((module) => module.tools.map((tool) => `${module.domain}.${tool.name}`));
    if (new Set(tools).size !== tools.length) ctx.addIssue('two tools of one address');
  });
export type ModuleCatalog = z.infer<typeof ModuleCatalogSchema>;

/**
 * topology/modules.mcp.json, in the format of `.mcp.json`: how each module is launched, under srt by the gateway, on
 * stdio. `type: http` is refused: a module is reachable by its parent on stdio only (§2, Un seul transport).
 */
export const ModulesMcpJsonSchema = z.strictObject({
  mcpServers: z.record(
    ModuleNameSchema,
    z.strictObject({
      type: z.literal('stdio').optional(),
      command: z.string().regex(/^[A-Za-z0-9._-]+$/),
      args: z.array(z.string()),
    }),
  ),
});
export type ModulesMcpJson = z.infer<typeof ModulesMcpJsonSchema>;

/** The profile of a client (§5, Profils clients): what it sees, and the bounds of each of its tasks. */
export const ClientProfileSchema = z.strictObject({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/),
  modules: z.array(ModuleNameSchema),
  model: z.enum(['haiku', 'sonnet', 'opus']),
  effort: z.enum(['low', 'medium', 'high']),
  mode: z.enum(['execute', 'catalog']),
  /** The deadline of a task, from which the deadlines of its calls derive. */
  max_duration_ms: Positive.max(86_400_000),
  /** Calls of modules per task, every depth counted. */
  max_calls: Positive.max(100_000),
  /** Depth of a call: 1 for a call of the client, the parent's plus one below. */
  max_depth: Positive.max(32),
  /** The owner's profile: it alone sees the tool that cancels a task. */
  owner: z.boolean().default(false),
});
export type ClientProfile = z.infer<typeof ClientProfileSchema>;

export const ClientProfilesSchema = z.strictObject({ profiles: z.array(ClientProfileSchema) });

/**
 * What the gateway loads, the three files together: every module of the catalogue has its server and every server its
 * module, and a profile sees only modules of the catalogue. Refused whole: a gateway with an invalid topology routes
 * nothing.
 */
export const TopologySchema = z
  .strictObject({
    catalog: ModuleCatalogSchema,
    servers: ModulesMcpJsonSchema,
    clients: ClientProfilesSchema,
  })
  .superRefine(({ catalog, servers, clients }, ctx) => {
    const modules = catalog.modules.map((module) => module.name).sort();
    const launched = Object.keys(servers.mcpServers).sort();
    if (modules.join() !== launched.join())
      ctx.addIssue(`modules [${modules.join(', ')}] but servers [${launched.join(', ')}]`);
    const names = clients.profiles.map((profile) => profile.name);
    if (new Set(names).size !== names.length) ctx.addIssue('two profiles of one name');
    for (const profile of clients.profiles) {
      for (const module of profile.modules) {
        if (!modules.includes(module)) ctx.addIssue(`${profile.name} sees ${module}, which is not a module`);
      }
    }
  });
export type Topology = z.infer<typeof TopologySchema>;
