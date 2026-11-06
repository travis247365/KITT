import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAfinfoDuration, estimateDuration } from '../src/carplay/podcast.js';

test('episode length comes from afinfo, not from a word count', () => {
  const afinfo = `File:           /x/evening-20261105T154506.m4a
File type ID:   m4af
Num Tracks:     1
----
Data format:     1 ch,  22050 Hz, 'aac ' (0x00000000) 0 bits/channel, 0 bytes/packet, 1024 frames/packet, 0 bytes/frame
estimated duration: 45.828209 sec
audio bytes: 379216
`;
  assert.equal(parseAfinfoDuration(afinfo), 46);
  assert.equal(parseAfinfoDuration(''), null);
  assert.equal(parseAfinfoDuration('estimated duration: 0 sec'), null);
  assert.equal(parseAfinfoDuration('estimated duration: nonsense sec'), null);
});

test('the word-count fallback is what the old code stored', () => {
  assert.equal(estimateDuration('one two three four five six'), 2);
  assert.equal(estimateDuration(''), 0);
  assert.equal(estimateDuration('   '), 0);
});
