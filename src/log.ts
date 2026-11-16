// All logging goes to stderr as JSON lines. stdout carries the MCP protocol and must stay clean.

type Level = 'info' | 'warn' | 'error';
type Fields = Record<string, unknown>;

function write(level: Level, msg: string, fields?: Fields): void {
  const line = { time: new Date().toISOString(), level, msg, ...fields };
  process.stderr.write(`${JSON.stringify(line)}\n`);
}

export const log = {
  info: (msg: string, fields?: Fields) => write('info', msg, fields),
  warn: (msg: string, fields?: Fields) => write('warn', msg, fields),
  error: (msg: string, fields?: Fields) => write('error', msg, fields),
};
