// cleanUserName: the name typed in Settings / first-run setup, made safe to store and to
// use as a speaker label in meeting transcripts ("Mohsin: Hello").
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanUserName, USER_NAME_MAX } from '../src/main/user-name';

test('keeps a normal name, trimmed', () => {
  assert.equal(cleanUserName('  Mohsin Shoaib  '), 'Mohsin Shoaib');
});

test('empty, spaces only, or not a string → empty (= no name)', () => {
  assert.equal(cleanUserName(''), '');
  assert.equal(cleanUserName('   '), '');
  assert.equal(cleanUserName(undefined), '');
  assert.equal(cleanUserName(42), '');
});

test('new lines, tabs and repeated spaces become one space', () => {
  assert.equal(cleanUserName('Mohsin\n\tShoaib'), 'Mohsin Shoaib');
  assert.equal(cleanUserName('A    B'), 'A B');
});

test('removes the colon, so "Name: text" lines stay readable', () => {
  assert.equal(cleanUserName('Dr: Ali'), 'Dr Ali');
});

test('removes invisible control characters', () => {
  assert.equal(cleanUserName('Ali\u0000\u0007'), 'Ali');
});

test('keeps non-English letters (Urdu, accents)', () => {
  assert.equal(cleanUserName('محسن'), 'محسن');
  assert.equal(cleanUserName('José'), 'José');
});

test(`cuts to ${USER_NAME_MAX} characters`, () => {
  const long = 'x'.repeat(USER_NAME_MAX + 10);
  assert.equal(cleanUserName(long).length, USER_NAME_MAX);
});
