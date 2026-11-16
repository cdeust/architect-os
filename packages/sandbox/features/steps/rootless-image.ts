import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { ROOT, Then, When, stored } from './helpers.js';

// rootless/image.json: the image of the sandboxes of the scenarios that run before a real rootless Docker daemon
// (rootless/*.feature), by its digest, and the node it holds. Read here, by the scenarios; and by the workflow
// rootless.yml, which fetches the image before them. Its scenario of the gate is rootless-image.feature.

const PINNED_IMAGE_FILE = join(ROOT, 'rootless', 'image.json');

/** An image by its sha256 digest, never by a tag alone; the absolute path of node inside it. Nothing else. */
const PinnedImageSchema = z.strictObject({
  image: z.string().regex(/^[a-z0-9][^\s@]*@sha256:[0-9a-f]{64}$/),
  node: z.string().regex(/^\/\S+$/),
});
export type PinnedImage = z.infer<typeof PinnedImageSchema>;

/** @throws when the text is not JSON, or not exactly an image by its digest and an absolute path of node. */
export function parsePinnedImage(text: string): PinnedImage {
  return PinnedImageSchema.parse(JSON.parse(text));
}

/** The committed image of the rootless scenarios. */
export const pinnedImage = (): PinnedImage => parsePinnedImage(readFileSync(PINNED_IMAGE_FILE, 'utf8'));

const DEFECTS: Record<string, (file: Record<string, unknown>) => unknown> = {
  'a tag in place of the digest': (file) => ({ ...file, image: 'node:26-bookworm-slim' }),
  'a tag and no digest after the at sign': (file) => ({ ...file, image: 'node@latest' }),
  'a digest of 63 characters': (file) => ({ ...file, image: String(file['image']).slice(0, -1) }),
  'a digest in capitals': (file) => ({ ...file, image: String(file['image']).toUpperCase() }),
  'a relative path of node': (file) => ({ ...file, node: 'bin/node' }),
  'a name of node and no path': (file) => ({ ...file, node: 'node' }),
  'no node': ({ node: _node, ...file }) => file,
  'no image': ({ image: _image, ...file }) => file,
  'a field nothing reads': (file) => ({ ...file, tag: 'node:26-bookworm-slim' }),
  'a list in place of the object': (file) => [file],
};

When('the committed image of the rootless scenarios is loaded', function () {
  this.state['pinned'] = pinnedImage();
});

Then('it is an image by its sha256 digest, and the absolute path of its node', function () {
  const { image, node } = stored<PinnedImage>(this, 'pinned');
  assert.match(image, /^node@sha256:[0-9a-f]{64}$/);
  assert.equal(node, '/usr/local/bin/node');
});

When('a copy of the committed image of the rootless scenarios is loaded with {}', function (defect: string) {
  const breakIt = DEFECTS[defect];
  assert.ok(breakIt, `no defect named "${defect}"`);
  const committed = JSON.parse(readFileSync(PINNED_IMAGE_FILE, 'utf8')) as Record<string, unknown>;
  try {
    parsePinnedImage(JSON.stringify(breakIt(committed)));
    this.state['copy'] = 'loaded';
  } catch {
    this.state['copy'] = 'refused';
  }
});

When('a copy of the committed image of the rootless scenarios that is not JSON is loaded', function () {
  try {
    parsePinnedImage(`${readFileSync(PINNED_IMAGE_FILE, 'utf8')}}`);
    this.state['copy'] = 'loaded';
  } catch {
    this.state['copy'] = 'refused';
  }
});

Then('that copy of the image of the rootless scenarios is refused', function () {
  assert.equal(stored<string>(this, 'copy'), 'refused');
});
