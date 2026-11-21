import assert from 'node:assert/strict';
import { MARKER_HEADER, readMarker, type MarkerReading } from '../../src/domain/marker.js';
import { kept, markerBytes, Then, When } from './support.js';

const shown = (reading: MarkerReading): string =>
  reading.kind === 'environment' ? `environment=${reading.name}` : reading.kind;

When('the runtime marker bytes {string} are read', function (text: string) {
  this.state['markerReading'] = readMarker(markerBytes(text));
});

When('a runtime marker of {int} bytes that names an environment is read', function (size: number) {
  const head = `${MARKER_HEADER}\nenvironment=`;
  const name = 'x'.repeat(size - head.length - 1);
  const bytes = new TextEncoder().encode(`${head}${name}\n`);
  assert.equal(bytes.length, size);
  this.state['markerReading'] = readMarker(bytes);
  this.state['markerName'] = name;
});

Then('the runtime marker reads as {string}', function (reading: string) {
  assert.equal(shown(kept<MarkerReading>(this, 'markerReading')), reading);
});

Then('the runtime marker reads as an environment: {word}', function (environment: string) {
  const reading = kept<MarkerReading>(this, 'markerReading');
  assert.deepEqual(
    reading,
    environment === 'yes' ? { kind: 'environment', name: kept(this, 'markerName') } : { kind: 'invalid' },
  );
});
