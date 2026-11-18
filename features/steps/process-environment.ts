import { Given } from './helpers.js';

// The steps that set or remove a variable of this process for the length of a scenario, used by the features of
// packages/sandbox, of tools/test-gate and of tools/deliver (host-process.feature): the variable is restored when the scenario ends.

Given('the process has the variable {string} set to {string}', function (name: string, value: string) {
  const before = process.env[name];
  process.env[name] = value;
  this.cleanups.push(() => {
    if (before === undefined) delete process.env[name];
    else process.env[name] = before;
  });
});

Given('the process has no variable {string}', function (name: string) {
  const before = process.env[name];
  delete process.env[name];
  this.cleanups.push(() => {
    if (before !== undefined) process.env[name] = before;
  });
});
