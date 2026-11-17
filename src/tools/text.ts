// Text pieces shared by tools. Results still go through ok() or fail() in result.ts.
import type { SafeFsReason } from '../fs/safe-fs.js';
import type { TicketParseReason } from '../sources/tickets.js';

// Why a file is left out: a safe-fs rule, or a ticket whose frontmatter cannot be used.
type SkipReason = SafeFsReason | TicketParseReason;

const REASON_LABELS: Record<SkipReason, string> = {
  too_large: 'too large',
  unreadable: 'unreadable',
  not_found: 'not found',
  denied: 'denied',
  extension: 'file type not allowed',
  outside_root: 'outside root',
  exists: 'already exists',
  unwritable: 'unwritable',
  no_frontmatter: 'no frontmatter',
  invalid_frontmatter: 'invalid frontmatter',
  missing_id: 'missing id',
  invalid_id: 'invalid id',
};

const REASON_TEXTS: Partial<Record<SkipReason, string>> = {
  no_frontmatter: 'the file has no frontmatter',
  invalid_frontmatter: 'the frontmatter is outside the supported subset',
  missing_id: 'the frontmatter has no id',
  invalid_id: 'the id may only contain letters, digits, ".", "_" and "-"',
};

/** `"1 file skipped (too large)."` or `"3 files skipped (2 too large, 1 unreadable)."`; empty if none. */
export function skippedLine(skipped: readonly { reason: SkipReason }[]): string {
  if (skipped.length === 0) return '';
  const counts = new Map<SkipReason, number>();
  for (const { reason } of skipped) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  const reasons =
    counts.size === 1
      ? REASON_LABELS[skipped[0]?.reason as SkipReason]
      : [...counts].map(([reason, count]) => `${count} ${REASON_LABELS[reason]}`).join(', ');
  const files = skipped.length === 1 ? 'file' : 'files';
  return `${skipped.length} ${files} skipped (${reasons}).`;
}

/** Why a file cannot be returned, for a `get_*` tool error. */
export function reasonText(reason: SkipReason, maxFileKb: number): string {
  if (reason === 'too_large') return `the file is larger than --max-file-kb (${maxFileKb} KB)`;
  const text = REASON_TEXTS[reason];
  if (text !== undefined) return text;
  return `the file is ${REASON_LABELS[reason]}`;
}
