// Release check: the npm tarball holds only the files a user needs. Runs `npm pack --dry-run` and
// fails on any other file, or when the CLI bundle is missing. Used by CI and the release workflow.
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ALLOWED_FILES = new Set(['README.md', 'LICENSE', 'package.json', 'CHANGELOG.md']);
const ALLOWED_DIR = 'dist/';
const REQUIRED = ['dist/cli.js', 'README.md', 'LICENSE', 'package.json', 'CHANGELOG.md'];

/** Returns one problem per unexpected or missing file; empty when the tarball is fine. */
export function packProblems(paths: string[]): string[] {
  const unexpected = paths
    .filter((path) => !ALLOWED_FILES.has(path) && !path.startsWith(ALLOWED_DIR))
    .map((path) => `unexpected file: ${path}`);
  const missing = REQUIRED.filter((path) => !paths.includes(path)).map(
    (path) => `missing file: ${path}`,
  );
  return [...unexpected, ...missing];
}

function packedPaths(): string[] {
  const output = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    encoding: 'utf8',
  });
  const [pack] = JSON.parse(output) as { files: { path: string }[] }[];
  return pack?.files.map((file) => file.path) ?? [];
}

function invokedDirectly(): boolean {
  try {
    const script = process.argv[1];
    return (
      script !== undefined && realpathSync(script) === realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  const paths = packedPaths();
  const problems = packProblems(paths);
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) process.exit(1);
  console.error(`npm tarball ok: ${paths.join(', ')}`);
}
