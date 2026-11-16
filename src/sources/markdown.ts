// Markdown helpers shared by the sources.

export interface Heading {
  line: number;
  level: number;
  text: string;
}

/** ATX headings outside fenced code blocks, so a `## Decision` inside a code sample is not a section. */
export function findHeadings(lines: string[]): Heading[] {
  const headings: Heading[] = [];
  let fence: string | undefined;
  for (const [line, content] of lines.entries()) {
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(content);
    if (fenceMatch) {
      const marker = fenceMatch[1] as string;
      if (fence === undefined) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
      continue;
    }
    if (fence !== undefined) continue;
    const match = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/.exec(content);
    if (match) {
      headings.push({
        line,
        level: (match[1] as string).length,
        text: (match[2] as string).trim(),
      });
    }
  }
  return headings;
}
