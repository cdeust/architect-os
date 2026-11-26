import assert from 'node:assert/strict';
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

/**
 * The calls a session of this repository is spared (docs/infrastructure.md, "What a session is spared"): a merge and
 * an edit of a ruleset, which belong to the merge resolver and to the owner, a push to `main` and a bypass, which the
 * ruleset of `main` refuses, and the two comparisons with `main` that CLAUDE.md forbids. Friction, not a control: a
 * rule matches the text of a command (code.claude.com/docs/en/permissions, "What a Bash rule doesn't match": a deny
 * rule "isn't a security boundary around the program"). features/integration/session-denials.feature shows what a
 * real Claude Code does with them.
 */
const SESSION_DENIALS = [
  'Bash(git merge-base *)',
  'Bash(gh pr update-branch *)',
  'Bash(gh pr merge *)',
  'Bash(gh * pr merge*)',
  'Bash(gh * --admin*)',
  'Bash(gh api */merge)',
  'Bash(gh api */merge *)',
  'Bash(gh api *mergePullRequest*)',
  'mcp__github__merge_pull_request',
  'mcp__github__update_pull_request_branch',
  'Bash(git push * main)',
  'Bash(git push * main *)',
  'Bash(git push *:main)',
  'Bash(git push *:main *)',
  'Bash(git push *:refs/heads/main)',
  'Bash(gh api *rulesets* -X*)',
  'Bash(gh api *rulesets* --method*)',
  'Bash(gh api *rulesets* --input*)',
  'Bash(gh api -X* *rulesets*)',
  'Bash(gh api --method* *rulesets*)',
  'Bash(gh api --input* *rulesets*)',
];
const DenialsSchema = z.object({ permissions: z.object({ deny: z.array(z.string()) }) });

function assertSessionDenials(settings: unknown): void {
  const { deny } = DenialsSchema.parse(settings).permissions;
  for (const rule of SESSION_DENIALS) assert.ok(deny.includes(rule), `${rule} is not denied`);
}

Then('the committed .claude\\/settings.json denies every call a session is spared', function () {
  assertSessionDenials(committedSettings());
});

Then('a .claude\\/settings.json without the denial {string} is rejected for it', function (rule: string) {
  assert.ok(SESSION_DENIALS.includes(rule), `${rule} is not a denial of the guard`);
  const settings = DenialsSchema.parse(committedSettings());
  const deny = settings.permissions.deny.filter((kept) => kept !== rule);
  assert.notEqual(deny.length, settings.permissions.deny.length, `${rule} is not in the committed file`);
  assert.throws(() => assertSessionDenials({ permissions: { deny } }), { message: `${rule} is not denied` });
});
