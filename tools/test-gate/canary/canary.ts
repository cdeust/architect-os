// The canary of rule 7 (tools/test-gate/gate.json `canary`): a module whose mutation statuses are known in advance.
// Stryker mutates it in every gate run; tools/test-gate/features/canary.feature asserts `sum` and `greet`, runs `twice`
// without asserting, and never reaches `thrice`. Not production code: no rule 5 or 6 reads it.

export function sum(a: number, b: number): number {
  return a + b;
}

export function greet(name: string): string {
  return `hello ${name}`;
}

export function twice(n: number): number {
  return n * 2;
}

export function thrice(n: number): number {
  return n * 3;
}
