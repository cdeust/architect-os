import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { Given, ROOT, Then, stored } from './helpers.js';

/**
 * Frontmatter of the descriptive files Claude Code reads in this repository. Field names follow the
 * subagent reference (code.claude.com/docs/en/sub-agents, "Frontmatter reference": name and description
 * are required; unrecognised fields are silently ignored, so a strict schema catches a misspelt one).
 */
const SubagentSchema = z.strictObject({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/),
  description: z.string().min(1),
  tools: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
});
const CommandSchema = z.strictObject({
  description: z.string().min(1),
  'allowed-tools': z.string().min(1).optional(),
  'argument-hint': z.string().optional(),
  model: z.string().optional(),
});

function frontmatter(text: string): unknown {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (match === null || (match[2] ?? '').trim() === '')
    throw new Error('expected YAML frontmatter and a body');
  return parse(match[1] ?? '');
}

interface Described {
  path: string;
  text: string;
}

Given('the committed file {string}', function (path: string) {
  this.state['described'] = { path, text: readFileSync(join(ROOT, path), 'utf8') } satisfies Described;
});

Then('it has a valid subagent frontmatter and a prompt', function () {
  const described = stored<Described>(this, 'described');
  this.state['subagent'] = SubagentSchema.parse(frontmatter(described.text));
});

Then('its subagent name is the name of the file', function () {
  const agent = stored<z.infer<typeof SubagentSchema>>(this, 'subagent');
  assert.equal(`${agent.name}.md`, basename(stored<Described>(this, 'described').path));
});

Then('it has a valid command frontmatter and a prompt', function () {
  CommandSchema.parse(frontmatter(stored<Described>(this, 'described').text));
});

Then('every subagent it names exists in .claude\\/agents', function () {
  const agents = readdirSync(join(ROOT, '.claude/agents')).filter((f) => f.endsWith('.md'));
  for (const named of stored<Described>(this, 'described').text.match(/[a-z]+-reviewer/g) ?? []) {
    assert.ok(agents.includes(`${named}.md`), `subagent ${named} does not exist`);
  }
});

Then('a text without frontmatter is rejected', function () {
  assert.throws(() => frontmatter('no frontmatter'));
});

Then('a subagent frontmatter without description is rejected', function () {
  assert.throws(() => SubagentSchema.parse(frontmatter('---\nname: x\n---\nbody\n')));
});

Then('a subagent frontmatter with the misspelt field allowed_tools is rejected', function () {
  assert.throws(() =>
    SubagentSchema.parse(frontmatter('---\nname: x\ndescription: d\nallowed_tools: Read\n---\nbody\n')),
  );
});

Then('the committed .claude\\/settings.json is valid JSON with permission rule lists', function () {
  const settings = JSON.parse(readFileSync(join(ROOT, '.claude/settings.json'), 'utf8')) as unknown;
  z.object({ permissions: z.object({ allow: z.array(z.string()), deny: z.array(z.string()) }) }).parse(
    settings,
  );
});

/** Project settings: the plugins every session in this repository runs with. */
const PluginsSchema = z.object({ enabledPlugins: z.record(z.string(), z.boolean()) });
const SECURITY_PLUGINS = [
  'security-guidance@claude-plugins-official',
  'claude-security@claude-plugins-official',
];

function assertSecurityPlugins(settings: unknown): void {
  const { enabledPlugins } = PluginsSchema.parse(settings);
  for (const plugin of SECURITY_PLUGINS)
    assert.equal(enabledPlugins[plugin], true, `${plugin} is not enabled`);
}

const committedSettings = (): unknown =>
  JSON.parse(readFileSync(join(ROOT, '.claude/settings.json'), 'utf8')) as unknown;

Then('the committed .claude\\/settings.json enables {string}', function (plugin: string) {
  assert.ok(SECURITY_PLUGINS.includes(plugin), `${plugin} is not a security plugin of the guard`);
  assertSecurityPlugins(committedSettings());
});

Then('a .claude\\/settings.json that turns {string} off is rejected', function (plugin: string) {
  const settings = PluginsSchema.parse(committedSettings());
  assert.throws(() =>
    assertSecurityPlugins({ ...settings, enabledPlugins: { ...settings.enabledPlugins, [plugin]: false } }),
  );
});

// P7 and P8 (docs/design/exigences-spec.md): no session of this repository merges a pull request or bypasses the
// rules of a branch. Two lines: the permission rules of Claude Code, which see through compound commands but not
// through `env`, `sh -c` or `bash -c` (code.claude.com/docs/en/permissions.md), and the PreToolUse hook of
// tools/session-guard, which reads the whole command and blocks with exit code 2 (code.claude.com/docs/en/hooks.md).
const FORGE_DENIALS = [
  'Bash(gh pr merge)',
  'Bash(gh pr merge *)',
  'Bash(gh * --admin*)',
  'Bash(gh api *merge*)',
  'Bash(gh api *Merge*)',
  'Bash(gh pr update-branch *)',
  'mcp__github__merge_pull_request',
  'mcp__github__update_pull_request_branch',
  'Bash(gh *pr merge*)',
  'Bash(curl */merge*)',
  'Bash(gh *owner-approved*)',
  'Bash(curl *owner-approved*)',
  'Bash(gh *addLabelsToLabelable*)',
  'Bash(gh *labelIds*)',
  'Bash(env *gh *)',
];
const GUARD_COMMAND = 'node "$CLAUDE_PROJECT_DIR/tools/session-guard/src/cli.ts"';
const GuardSchema = z.object({
  permissions: z.object({ deny: z.array(z.string()) }),
  hooks: z.object({
    PreToolUse: z.array(
      z.object({
        matcher: z.string(),
        hooks: z.array(z.object({ type: z.string(), command: z.string() })),
      }),
    ),
  }),
});

function assertForgeGuard(settings: unknown): void {
  const { permissions, hooks } = GuardSchema.parse(settings);
  for (const rule of FORGE_DENIALS) assert.ok(permissions.deny.includes(rule), `${rule} is not denied`);
  const guard = hooks.PreToolUse.filter(({ hooks: entries }) =>
    entries.some(({ type, command }) => type === 'command' && command === GUARD_COMMAND),
  );
  assert.equal(guard.length, 1, 'the session guard is not registered once as a PreToolUse command hook');
  // The matcher is a JavaScript regular expression when it holds other characters than letters, digits, `_`, `-`,
  // spaces, `,` and `|` (hooks.md, « Matcher »): it must reach Bash and every MCP tool.
  const matcher = new RegExp(guard[0]!.matcher);
  for (const tool of ['Bash', 'mcp__github__merge_pull_request', 'mcp__other__update_pull_request_branch'])
    assert.ok(matcher.test(tool), `the matcher of the session guard does not reach ${tool}`);
}

const FORGE_DEFECTS: Record<string, (s: Record<string, any>) => unknown> = {
  'no denial of gh pr merge': (s) =>
    (s['permissions']['deny'] = s['permissions']['deny'].filter((r: string) => r !== 'Bash(gh pr merge *)')),
  'no denial of --admin': (s) =>
    (s['permissions']['deny'] = s['permissions']['deny'].filter((r: string) => r !== 'Bash(gh * --admin*)')),
  'no denial of the MCP merge tool': (s) =>
    (s['permissions']['deny'] = s['permissions']['deny'].filter(
      (r: string) => r !== 'mcp__github__merge_pull_request',
    )),
  'no denial of the merge by the API': (s) =>
    (s['permissions']['deny'] = s['permissions']['deny'].filter((r: string) => r !== 'Bash(gh api *merge*)')),
  ...Object.fromEntries(
    [
      'Bash(gh *pr merge*)',
      'Bash(curl */merge*)',
      'Bash(gh *owner-approved*)',
      'Bash(curl *owner-approved*)',
      'Bash(gh *addLabelsToLabelable*)',
      'Bash(gh *labelIds*)',
      'Bash(env *gh *)',
      'Bash(gh pr update-branch *)',
      'mcp__github__update_pull_request_branch',
    ].map((rule) => [
      `no denial ${rule}`,
      (s: Record<string, any>) =>
        (s['permissions']['deny'] = s['permissions']['deny'].filter((r: string) => r !== rule)),
    ]),
  ),
  'no hook': (s) => delete s['hooks'],
  'a hook on another command': (s) =>
    (s['hooks']['PreToolUse'][0]['hooks'][0]['command'] = 'node tools/session-guard/src/cli.ts'),
  'a hook of another type': (s) => (s['hooks']['PreToolUse'][0]['hooks'][0]['type'] = 'prompt'),
  'a matcher of Bash alone': (s) => (s['hooks']['PreToolUse'][0]['matcher'] = 'Bash'),
  'a matcher of MCP alone': (s) => (s['hooks']['PreToolUse'][0]['matcher'] = 'mcp__.*'),
};

Then(
  'the committed .claude\\/settings.json denies the merge and the bypass, and registers the session guard',
  function () {
    assertForgeGuard(committedSettings());
  },
);

Then('a .claude\\/settings.json with {} is rejected', function (defect: string) {
  const breakIt = FORGE_DEFECTS[defect];
  assert.ok(breakIt, `no defect named "${defect}"`);
  const settings = structuredClone(committedSettings()) as Record<string, any>;
  breakIt(settings);
  assert.throws(() => assertForgeGuard(settings));
});

Then(
  'the session guard started as Claude Code starts it exits with {int} for the command {string}',
  function (code: number, command: string) {
    // The command of the hook, with the root of this checkout as `CLAUDE_PROJECT_DIR`, given the call on stdin:
    // plain Node, from source, as Claude Code runs it.
    const run = spawnSync('/bin/sh', ['-c', GUARD_COMMAND], {
      input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } }),
      env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', CLAUDE_PROJECT_DIR: ROOT },
      encoding: 'utf8',
    });
    assert.equal(run.status, code, run.stderr);
    if (code === 2) assert.match(run.stderr, /^architect-os session-guard: /);
    else assert.equal(run.stderr, '');
  },
);
