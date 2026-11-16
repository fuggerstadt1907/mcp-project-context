// Output boundary for tools and resources (ADR 0003, ADR 0005). Every result is redacted here and
// every call writes exactly one audit line with counts only: no arguments, ids or content.

import {
  type CallToolResult,
  type ListResourcesResult,
  type ReadResourceResult,
  ResourceNotFoundError,
} from '@modelcontextprotocol/server';
import { SafeFsError } from '../fs/safe-fs.js';
import { log } from '../log.js';
import { redact } from '../redact.js';

type TextBlock = { type: 'text'; text: string };
type ToolResult = CallToolResult & { content: [TextBlock] };

// Redaction count per result built by ok() or fail(). withAudit reads it for the audit line and
// treats a result that is missing here as unredacted.
const redactionCounts = new WeakMap<object, number>();

function redactText(value: string, counter: { count: number }): string {
  const { text, findings } = redact(value);
  counter.count += findings.length;
  return text;
}

// Expects JSON data. Keys are redacted too, because a source may build them from content
// (counts per assignee). The copy is frozen so a handler cannot put raw text back after ok().
function redactDeep(value: unknown, counter: { count: number }): unknown {
  if (typeof value === 'string') return redactText(value, counter);
  if (Array.isArray(value)) return Object.freeze(value.map((item) => redactDeep(item, counter)));
  if (value !== null && typeof value === 'object') {
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          redactText(key, counter),
          redactDeep(item, counter),
        ]),
      ),
    );
  }
  return value;
}

/** Successful tool result. Redacts `text` and every string value inside `structured`. */
export function ok<T extends Record<string, unknown>>(
  structured: T,
  text: string,
): ToolResult & { structuredContent: T } {
  const counter = { count: 0 };
  const result = Object.freeze({
    content: redactDeep([{ type: 'text', text }], counter) as [TextBlock],
    structuredContent: redactDeep(structured, counter) as T,
  });
  redactionCounts.set(result, counter.count);
  return result;
}

/** Tool error the agent can act on. The message is redacted like any other output. */
export function fail(message: string): ToolResult & { isError: true } {
  const counter = { count: 0 };
  const result = Object.freeze({
    isError: true as const,
    content: redactDeep([{ type: 'text', text: message }], counter) as [TextBlock],
  });
  redactionCounts.set(result, counter.count);
  return result;
}

function internalError(where: string, error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error;
  const message = error instanceof Error ? redact(error.message).text : undefined;
  log.error('handler failed', { where, error: name, message });
  return `Internal error in ${where}. Try again or report it.`;
}

function bytes(result: unknown): number {
  return Buffer.byteLength(JSON.stringify(result), 'utf8');
}

/**
 * Wraps a tool handler. Measures duration, turns every exception into a tool error (SafeFsError
 * keeps its message, anything else gets a generic one) and writes one `tool_call` audit line.
 */
export function withAudit<Args extends unknown[]>(
  tool: string,
  handler: (...args: Args) => CallToolResult | Promise<CallToolResult>,
): (...args: Args) => Promise<CallToolResult> {
  return async (...args) => {
    const start = performance.now();
    let result: CallToolResult;
    try {
      result = await handler(...args);
      if (!redactionCounts.has(result)) {
        result = fail(internalError(tool, new Error('result not built with ok() or fail()')));
      }
    } catch (error) {
      result = fail(error instanceof SafeFsError ? error.message : internalError(tool, error));
    }
    log.audit('tool_call', {
      tool,
      ok: result.isError !== true,
      ms: Math.round(performance.now() - start),
      bytes: bytes(result),
      redactions: redactionCounts.get(result) ?? 0,
    });
    return result;
  };
}

/**
 * Wraps a resource read callback. Redacts every text entry and writes one `resource_read` audit
 * line with the URI scheme only, never the id. Resources have no `isError`, so failures are
 * rethrown after the audit line: not_found as ResourceNotFoundError, other SafeFsErrors with their
 * redacted message, anything else with a generic message.
 */
export function withResourceAudit<Args extends [URL, ...unknown[]]>(
  scheme: string,
  read: (...args: Args) => ReadResourceResult | Promise<ReadResourceResult>,
): (...args: Args) => Promise<ReadResourceResult> {
  return async (...args) => {
    const start = performance.now();
    const counter = { count: 0 };
    let result: ReadResourceResult | undefined;
    let failure: Error | undefined;
    try {
      const raw = await read(...args);
      // Built field by field so nothing unredacted (such as _meta) passes through.
      result = {
        contents: raw.contents.map((entry) => {
          if (!('text' in entry)) throw new Error('binary resource contents are not supported');
          return {
            uri: redactText(entry.uri, counter),
            ...(entry.mimeType === undefined ? {} : { mimeType: entry.mimeType }),
            text: redactText(entry.text, counter),
          };
        }),
      };
    } catch (error) {
      failure = resourceError(scheme, args[0], error);
    }
    log.audit('resource_read', {
      scheme,
      ok: failure === undefined,
      ms: Math.round(performance.now() - start),
      bytes: result ? bytes(result) : 0,
      redactions: counter.count,
    });
    if (result === undefined) throw failure;
    return result;
  };
}

/**
 * Wraps a resource template's `list` callback. Names and titles come from file content, so every
 * entry is rebuilt from `uri`, `name`, `title`, `description` and `mimeType`, with text redacted.
 * A listing is not a read, so it writes no audit line.
 */
export function withResourceList<Args extends unknown[]>(
  list: (...args: Args) => ListResourcesResult | Promise<ListResourcesResult>,
): (...args: Args) => Promise<ListResourcesResult> {
  return async (...args) => {
    const counter = { count: 0 };
    const raw = await list(...args);
    return {
      resources: raw.resources.map((resource) => ({
        uri: redactText(resource.uri, counter),
        name: redactText(resource.name, counter),
        ...(resource.title === undefined ? {} : { title: redactText(resource.title, counter) }),
        ...(resource.description === undefined
          ? {}
          : { description: redactText(resource.description, counter) }),
        ...(resource.mimeType === undefined ? {} : { mimeType: resource.mimeType }),
      })),
    };
  };
}

function resourceError(scheme: string, uri: URL, error: unknown): Error {
  if (error instanceof ResourceNotFoundError) return error;
  if (error instanceof SafeFsError) {
    if (error.reason === 'not_found') return new ResourceNotFoundError(uri.href);
    return new Error(redact(error.message).text);
  }
  return new Error(internalError(`${scheme} resource`, error));
}
