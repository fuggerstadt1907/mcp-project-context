// Input schemas for tools: unknown fields are an error (decisions 93, 94).
import * as z from 'zod/v4';
import { redact } from '../redact.js';

/**
 * `z.strictObject` whose error names the unknown fields. The SDK sends zod messages to the client
 * without going through ok()/fail(), so the names are redacted here; values are never echoed.
 */
export function strictInput<Shape extends z.ZodRawShape>(shape: Shape) {
  return z.strictObject(shape, {
    error: (issue) =>
      issue.code === 'unrecognized_keys'
        ? `Unknown field(s): ${issue.keys.map((key) => redact(key).text).join(', ')}`
        : undefined,
  });
}
