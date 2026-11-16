// Frontmatter parser for a fixed subset of YAML (requirements, Data & schema). No YAML dependency.
// Each line is `key: value`; a value is a plain string, a quoted string or an inline array of
// plain or quoted items. Anything else (block lists, nesting, multi-line values, comments,
// anchors, flow maps) makes the whole block invalid, so callers can skip the file.

export type FrontmatterValue = string | string[];

export type FrontmatterResult =
  | { kind: 'ok'; data: Record<string, FrontmatterValue>; body: string }
  // The file does not start with a `---` line.
  | { kind: 'none' }
  // `line` is 1-based in the file. `problem` never contains file content, so it is safe to log.
  | { kind: 'invalid'; line: number; problem: string };

const KEY_LINE = /^([A-Za-z_][\w.-]*):(?:[ \t]+(.*))?$/;
// Characters that start YAML syntax outside the subset when they open a plain value.
// `-5` is a plain value, `- x` a block list.
const PLAIN_START_DENIED = /^(?:[?:,[\]{}#&*!|>%@`]|-(?:\s|$))/;

class Invalid extends Error {}

export function parseFrontmatter(markdown: string): FrontmatterResult {
  const lines = markdown.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  if (lines[0]?.trimEnd() !== '---') return { kind: 'none' };
  const end = lines.findIndex((line, index) => index > 0 && line.trimEnd() === '---');
  if (end === -1) return { kind: 'invalid', line: 1, problem: 'no closing --- line' };

  const data: Record<string, FrontmatterValue> = {};
  for (let index = 1; index < end; index++) {
    const line = lines[index] as string;
    if (line.trim() === '') continue;
    const match = KEY_LINE.exec(line);
    if (!match) {
      return { kind: 'invalid', line: index + 1, problem: 'not a `key: value` line' };
    }
    const key = match[1] as string;
    if (Object.hasOwn(data, key)) {
      return { kind: 'invalid', line: index + 1, problem: 'duplicate key' };
    }
    try {
      data[key] = parseValue((match[2] ?? '').trim());
    } catch (error) {
      if (!(error instanceof Invalid)) throw error;
      return { kind: 'invalid', line: index + 1, problem: error.message };
    }
  }
  return { kind: 'ok', data, body: lines.slice(end + 1).join('\n') };
}

function parseValue(value: string): FrontmatterValue {
  if (value.startsWith('[')) return parseArray(value);
  return parseScalar(value);
}

function parseArray(value: string): string[] {
  if (!value.endsWith(']')) throw new Invalid('inline array without closing ]');
  const inner = value.slice(1, -1).trim();
  if (inner === '') return [];
  const items: string[] = [];
  let rest = inner;
  while (true) {
    const { item, after } = readItem(rest);
    items.push(item);
    if (after === '') return items;
    if (!after.startsWith(',')) throw new Invalid('unexpected text after an array item');
    rest = after.slice(1).trim();
    if (rest === '') throw new Invalid('empty array item');
  }
}

// One array item at the start of `text`, quoted or plain. `after` is the trimmed rest.
function readItem(text: string): { item: string; after: string } {
  if (text.startsWith('"') || text.startsWith("'")) {
    const { value, end } = readQuoted(text);
    return { item: value, after: text.slice(end).trim() };
  }
  const comma = text.indexOf(',');
  const raw = (comma === -1 ? text : text.slice(0, comma)).trim();
  if (raw === '') throw new Invalid('empty array item');
  if (/["'[\]{}]/.test(raw)) throw new Invalid('nested or quoted text inside a plain array item');
  return { item: plain(raw), after: comma === -1 ? '' : text.slice(comma) };
}

function parseScalar(value: string): string {
  if (value === '') return '';
  if (value.startsWith('"') || value.startsWith("'")) {
    const { value: parsed, end } = readQuoted(value);
    if (value.slice(end).trim() !== '') throw new Invalid('text after a quoted value');
    return parsed;
  }
  return plain(value);
}

function plain(value: string): string {
  if (PLAIN_START_DENIED.test(value)) throw new Invalid('value starts with YAML syntax');
  // `: ` would be a nested mapping and ` #` a comment in YAML.
  if (/:(\s|$)/.test(value) || /\s#/.test(value)) {
    throw new Invalid('plain value with `: ` or ` #`; quote it');
  }
  return value;
}

// A quoted string at the start of `text`. Double quotes unescape `\"` and `\\`; other escapes stay
// as written. Single quotes unescape `''`. `end` is the index after the closing quote.
function readQuoted(text: string): { value: string; end: number } {
  const quote = text[0];
  let value = '';
  for (let index = 1; index < text.length; index++) {
    const char = text[index] as string;
    if (quote === '"' && char === '\\') {
      const next = text[index + 1];
      if (next === '"' || next === '\\') {
        value += next;
        index++;
        continue;
      }
      value += char;
      continue;
    }
    if (char === quote) {
      if (quote === "'" && text[index + 1] === "'") {
        value += "'";
        index++;
        continue;
      }
      return { value, end: index + 1 };
    }
    value += char;
  }
  throw new Invalid('quoted value without closing quote');
}
