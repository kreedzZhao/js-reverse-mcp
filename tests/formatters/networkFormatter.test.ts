/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {test} from 'node:test';

import {
  getFormattedHeaderEntries,
  headersContainSensitiveValues,
} from '../../src/formatters/networkFormatter.js';

test('redacts sensitive inline header values', () => {
  const lines = getFormattedHeaderEntries([
    {name: 'Accept', value: 'application/json'},
    {name: 'Cookie', value: 'sid=abc; theme=light'},
    {name: 'Authorization', value: 'Bearer abc.def'},
    {name: 'X-CSRF-Token', value: 'secret'},
  ]);

  assert.deepEqual(lines, [
    '- Accept:application/json',
    '- Cookie:<redacted cookie header; names: sid, theme; 20 chars>',
    '- Authorization:<redacted authorization; scheme: Bearer; 14 chars>',
    '- X-CSRF-Token:<redacted sensitive header; 6 chars>',
  ]);
});

test('keeps exact header values when redaction is disabled', () => {
  const lines = getFormattedHeaderEntries(
    [{name: 'Authorization', value: 'Bearer abc.def'}],
    {redactSensitiveValues: false},
  );

  assert.deepEqual(lines, ['- Authorization:Bearer abc.def']);
});

test('does not treat Set-Cookie as a redacted generic header', () => {
  assert.equal(
    headersContainSensitiveValues([{name: 'Set-Cookie', value: 'sid=abc'}]),
    false,
  );
});
