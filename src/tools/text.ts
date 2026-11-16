// Text pieces shared by tools. Results still go through ok() or fail() in result.ts.
import type { SafeFsReason } from '../fs/safe-fs.js';

const REASON_LABELS: Record<SafeFsReason, string> = {
  too_large: 'too large',
  unreadable: 'unreadable',
  not_found: 'not found',
  denied: 'denied',
  extension: 'file type not allowed',
  outside_root: 'outside root',
};

/** `"1 file skipped (too large)."` or `"3 files skipped (2 too large, 1 unreadable)."`; empty if none. */
export function skippedLine(skipped: readonly { reason: SafeFsReason }[]): string {
  if (skipped.length === 0) return '';
  const counts = new Map<SafeFsReason, number>();
  for (const { reason } of skipped) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  const reasons =
    counts.size === 1
      ? REASON_LABELS[skipped[0]?.reason as SafeFsReason]
      : [...counts].map(([reason, count]) => `${count} ${REASON_LABELS[reason]}`).join(', ');
  const files = skipped.length === 1 ? 'file' : 'files';
  return `${skipped.length} ${files} skipped (${reasons}).`;
}

/** Why a file cannot be returned, for a `get_*` tool error. */
export function reasonText(reason: SafeFsReason, maxFileKb: number): string {
  if (reason === 'too_large') return `the file is larger than --max-file-kb (${maxFileKb} KB)`;
  return `the file is ${REASON_LABELS[reason]}`;
}
