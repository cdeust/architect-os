import type { Files } from '../domain/ports.js';

export class InMemoryFiles implements Files {
  private readonly held = new Map<string, string>();

  read(path: string): string | undefined {
    return this.held.get(path);
  }

  exists(path: string): boolean {
    return this.held.has(path);
  }

  write(path: string, text: string): void {
    this.held.set(path, text);
  }
}
