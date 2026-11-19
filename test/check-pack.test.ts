// The release check that keeps the npm tarball to dist/ and the package docs (ticket 10).
import { describe, expect, it } from 'vitest';
import { packProblems } from '../scripts/check-pack.js';

const GOOD = ['CHANGELOG.md', 'LICENSE', 'README.md', 'dist/cli.js', 'package.json'];

describe('packProblems', () => {
  it('accepts the expected tarball', () => {
    expect(packProblems(GOOD)).toEqual([]);
  });

  it('accepts extra files under dist/', () => {
    expect(packProblems([...GOOD, 'dist/cli.js.map'])).toEqual([]);
  });

  it.each([
    'src/cli.ts',
    'test/support.ts',
    'examples/demo-project/CONVENTIONS.md',
    '.env',
    'docs/WORKLOG.md',
    'distx/cli.js',
  ])('rejects %s', (path) => {
    expect(packProblems([...GOOD, path])).toEqual([`unexpected file: ${path}`]);
  });

  it('reports a missing CLI bundle', () => {
    expect(packProblems(GOOD.filter((path) => path !== 'dist/cli.js'))).toEqual([
      'missing file: dist/cli.js',
    ]);
  });
});
