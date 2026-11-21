import type { Ignorer, NodePath } from '@stryker-mutator/api/ignore';
import { resolve } from 'node:path';
import type { mutationLots } from './mutation-inventory.js';

type Lot = Awaited<ReturnType<typeof mutationLots>>[number];
type Point = { readonly line: number; readonly column: number };
type Span = { readonly start: Point; readonly end: Point };

// The pinned Stryker instrumenter passes Babel paths through the empty Ignorer.NodePath type.
interface BabelPath extends NodePath {
  readonly hub: { readonly file: { readonly opts: { readonly filename: string } } };
  readonly node: { readonly loc?: Span | null };
}

function atOrBefore(left: Point, right: Point): boolean {
  return left.line < right.line || (left.line === right.line && left.column <= right.column);
}

function babelPoint(point: Point): Point {
  return { line: point.line, column: point.column - 1 };
}

/** An ignored ancestor would also suppress its descendants. Keep every ancestor of a selected span. */
export function inventoryIgnorer(root: string, lots: readonly Lot[]): Ignorer {
  const files = new Map(
    lots.map((lot) => [
      resolve(root, lot.file),
      {
        whole: lot.whole,
        spans: lot.mutants
          .filter(({ ignored }) => ignored === null)
          .map(({ start, end }) => ({ start: babelPoint(start), end: babelPoint(end) })),
      },
    ]),
  );
  return {
    shouldIgnore(path: BabelPath) {
      const filename = path.hub.file.opts.filename;
      const file = files.get(resolve(root, filename));
      if (file === undefined) throw new Error('instrumentation hors inventaire : ' + filename);
      const loc = path.node.loc;
      if (file.whole || loc == null) return undefined;
      if (file.spans.some(({ start, end }) => atOrBefore(loc.start, start) && atOrBefore(end, loc.end)))
        return undefined;
      return 'hors lot de mutation natif';
    },
  };
}
