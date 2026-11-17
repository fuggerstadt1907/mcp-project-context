import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from '../src/sources/frontmatter.js';

const fm = (...lines: string[]) => `---\n${lines.join('\n')}\n---\nBody.\n`;

function data(markdown: string) {
  const result = parseFrontmatter(markdown);
  if (result.kind !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(result)}`);
  return result.data;
}

describe('parseFrontmatter', () => {
  it('parses plain strings and inline arrays and returns the body', () => {
    const result = parseFrontmatter(fm('id: T-003', 'status: todo', 'labels: [api, security]'));
    expect(result).toEqual({
      kind: 'ok',
      data: { id: 'T-003', status: 'todo', labels: ['api', 'security'] },
      body: 'Body.\n',
    });
  });

  it('keeps `:` and `,` inside quoted values', () => {
    expect(
      data(
        fm(
          'title: "Rate-limit: magic links, part 2"',
          "note: 'a: b, c'",
          'labels: ["a, b", \'c: d\', e]',
        ),
      ),
    ).toEqual({
      title: 'Rate-limit: magic links, part 2',
      note: 'a: b, c',
      labels: ['a, b', 'c: d', 'e'],
    });
  });

  it("unescapes \\\" and \\\\ in double quotes and '' in single quotes", () => {
    expect(data(fm('a: "say \\"hi\\" \\\\ \\n"', "b: 'it''s'"))).toEqual({
      a: 'say "hi" \\ \\n',
      b: "it's",
    });
  });

  it('parses [] as an empty list and an empty value as an empty string', () => {
    expect(data(fm('labels: []', 'title:', 'other: [ ]'))).toEqual({
      labels: [],
      title: '',
      other: [],
    });
  });

  it('trims plain values, allows blank lines and keeps plain text with inner colons', () => {
    expect(data(fm('title:   Spaces around   ', '', 'time: 10:30', 'n: -5'))).toEqual({
      title: 'Spaces around',
      time: '10:30',
      n: '-5',
    });
  });

  it('skips comment lines that start with #', () => {
    expect(data(fm('# These are optional elements.', 'id: T-1', '#no space'))).toEqual({
      id: 'T-1',
    });
  });

  it('treats __proto__ as an ordinary key', () => {
    const parsed = data(fm('__proto__: [a]', 'id: T-1'));
    expect(Object.getPrototypeOf(parsed)).toBeNull();
    expect(parsed.__proto__).toEqual(['a']);
    expect(parsed.id).toBe('T-1');
  });

  it('accepts CRLF line endings and a BOM', () => {
    const result = parseFrontmatter('﻿---\r\nid: T-1\r\n---\r\nBody.\r\n');
    expect(result).toEqual({ kind: 'ok', data: { id: 'T-1' }, body: 'Body.\n' });
  });

  it.each([
    ['no frontmatter', '# Title\n'],
    ['frontmatter not at the very top', '\n---\nid: T-1\n---\n'],
  ])('returns none for %s', (_name, markdown) => {
    expect(parseFrontmatter(markdown)).toEqual({ kind: 'none' });
  });

  it.each([
    ['a block list', fm('labels:', '  - api')],
    ['a block list without indent', fm('labels:', '- api')],
    ['nesting', fm('meta:', '  owner: x')],
    ['a multi-line plain value', fm('title: first', '  second line')],
    ['a block scalar', fm('description: |', '  text')],
    ['a folded scalar', fm('description: >', '  text')],
    ['a flow map', fm('meta: {a: 1}')],
    ['a nested array', fm('labels: [[a], b]')],
    ['an unclosed array', fm('labels: [a, b')],
    ['an empty array item', fm('labels: [a, , b]')],
    ['a trailing comma', fm('labels: [a, b,]')],
    ['an unclosed quote', fm('title: "open')],
    ['a quoted string spanning lines', fm('title: "open', 'still"')],
    ['text after a quoted value', fm('title: "a" b')],
    ['an unquoted `: `', fm('title: Rate-limit: magic links')],
    ['an indented comment line', fm('  # comment', 'id: T-1')],
    ['a trailing comment', fm('id: T-1 # comment')],
    ['an anchor', fm('id: &a T-1')],
    ['an alias', fm('id: *a')],
    ['a tag', fm('id: !str T-1')],
    ['a duplicate key', fm('id: T-1', 'id: T-2')],
    ['a key without a space after the colon', fm('id:T-1')],
    ['an indented key', fm(' id: T-1')],
    ['a missing closing ---', '---\nid: T-1\n'],
  ])('rejects %s', (_name, markdown) => {
    const result = parseFrontmatter(markdown);
    expect(result.kind).toBe('invalid');
  });

  it('reports the line and a problem without file content', () => {
    const result = parseFrontmatter(fm('id: T-1', 'secret: "unclosed'));
    expect(result).toEqual({
      kind: 'invalid',
      line: 3,
      problem: 'quoted value without closing quote',
      body: 'Body.\n',
    });
  });

  it('gives no body when the closing --- line is missing', () => {
    expect(parseFrontmatter('---\nid: T-1\n')).toEqual({
      kind: 'invalid',
      line: 1,
      problem: 'no closing --- line',
    });
  });
});
