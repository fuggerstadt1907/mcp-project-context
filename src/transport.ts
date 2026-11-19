// Second output boundary, for errors the SDK builds itself (decision 99). Unknown tools, unknown
// resource URIs and input validation are answered before withAudit or withResourceAudit run, and
// their messages can quote what the agent sent. Results built by ok() are already redacted.
import type { JSONRPCMessage, Transport } from '@modelcontextprotocol/server';
import { redactDeep } from './tools/result.js';

/** Wraps a transport so that every error response and every `isError` result is redacted. */
export function redactErrors<T extends Transport>(transport: T): T {
  return new Proxy(transport, {
    get(target, property) {
      if (property === 'send') {
        return (message: JSONRPCMessage, options?: Parameters<Transport['send']>[1]) =>
          target.send(redactMessage(message), options);
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
    set(target, property, value) {
      return Reflect.set(target, property, value, target);
    },
  });
}

function redactMessage(message: JSONRPCMessage): JSONRPCMessage {
  const counter = { count: 0 };
  if ('error' in message) {
    return { ...message, error: redactDeep(message.error, counter) } as JSONRPCMessage;
  }
  if ('result' in message && message.result.isError === true) {
    return {
      ...message,
      result: { ...message.result, content: redactDeep(message.result.content, counter) },
    } as JSONRPCMessage;
  }
  return message;
}
