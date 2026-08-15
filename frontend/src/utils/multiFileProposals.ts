/**
 * G2a — multi-file diff review screen (PLAN_SYSTEM_TASKS.md Phase G).
 *
 * Parses an AI chat response for multi-file code proposals, and computes
 * line-diff stats for the review screen's +N/−N badges.
 *
 * FILE-PATH CONVENTION: a fenced code block is treated as a file
 * proposal when its info string includes `path=<relative/path>`, e.g.
 * ` ```tsx path=src/components/Button.tsx `. This is a NEW convention —
 * nothing in the existing single-file chat Apply path
 * (ChatInterface.tsx's CodeBlockHeader) ever needed one, since it just
 * applies a block's raw content to whichever file is already open.
 * ChatInterface.tsx only instructs the AI to use this format when
 * `activeContext.projectStructure` is present (see its systemPrompt
 * construction), so a bare code block with no `path=` tag — the
 * overwhelming majority of chat responses — is intentionally left alone
 * and keeps working exactly as it did before this file existed.
 */

export interface FileProposal {
  path: string;
  language: string;
  newContent: string;
}

const FILE_BLOCK_RE = /```(\w+)?\s+path=(\S+)\r?\n([\s\S]*?)```/g;

/**
 * Returns every path-tagged code block in an assistant message. Returns
 * an empty array (not null) when there are none or only one — callers
 * decide the "is this actually a multi-file proposal" threshold
 * (ChatInterface.tsx currently requires 2+, since a single path-tagged
 * block isn't meaningfully different from the existing single-file
 * Apply flow and doesn't need a whole review screen for one file).
 */
export function parseMultiFileProposals(content: string): FileProposal[] {
  const proposals: FileProposal[] = [];
  let match: RegExpExecArray | null;

  // Reset lastIndex since FILE_BLOCK_RE is a shared module-level regex
  // with the global flag — without this, a previous call's exhausted
  // position would carry over and silently miss matches on the next one.
  FILE_BLOCK_RE.lastIndex = 0;

  while ((match = FILE_BLOCK_RE.exec(content)) !== null) {
    const [, language, path, body] = match;
    // Same trailing-newline trim CodeBlockHeader already does for its
    // single-block case, so a proposal's newContent doesn't pick up one
    // extra blank line at the end purely from how the fence closes.
    proposals.push({
      path,
      language: language || 'text',
      newContent: body.replace(/\n$/, ''),
    });
  }

  return proposals;
}

/**
 * G2d — "short natural-language change summary above the file list."
 * Deliberately NOT a second AI call to summarize the first response —
 * that's real latency + tokens for something the model usually already
 * said for free: a well-formed multi-file response naturally has
 * explanatory prose before its first fenced block ("I'll add dark mode
 * support across two files: ..."). This just extracts that prose as
 * given. Falls back to a generic line only when there genuinely isn't
 * any (a bare list of fences with no lead-in text at all) — never
 * fabricates a summary the model didn't actually write.
 */
export function extractSummaryText(content: string, fileCount: number): string {
  FILE_BLOCK_RE.lastIndex = 0;
  const firstMatch = FILE_BLOCK_RE.exec(content);
  const lead = firstMatch ? content.slice(0, firstMatch.index).trim() : content.trim();

  // Cap length — this sits in a fixed-height header, not a scrollable
  // area; an unusually verbose lead-in shouldn't blow past a couple of
  // lines. Cuts at the nearest sentence boundary within the cap rather
  // than a hard mid-word truncation where possible.
  const CAP = 240;
  if (lead.length <= CAP) {
    return lead || `Proposed changes to ${fileCount} file${fileCount === 1 ? '' : 's'}.`;
  }
  const truncated = lead.slice(0, CAP);
  const lastSentenceEnd = Math.max(truncated.lastIndexOf('. '), truncated.lastIndexOf('.\n'));
  return (lastSentenceEnd > CAP * 0.5 ? truncated.slice(0, lastSentenceEnd + 1) : truncated.trimEnd() + '…');
}

/** Line-diff stats for a review screen's +added/−removed badge. */
export interface DiffStats {
  added: number;
  removed: number;
}

// Above this, an exact LCS is O(n*m) memory/time in the browser — for a
// multi-thousand-line file that's real jank on a click. Past the cap,
// fall back to a coarse (but honest — never silently wrong, just less
// precise) estimate instead of hanging the tab.
const EXACT_DIFF_LINE_CAP = 2000;

/**
 * Line-level added/removed counts between two file contents. Genuine
 * LCS-based diff (not just a length delta) so e.g. a single line changed
 * in the middle of a large file reads as "+1 -1", not "+0 -0" from the
 * two texts happening to have the same line count.
 */
export function diffLineStats(oldText: string, newText: string): DiffStats {
  const oldLines = oldText.length ? oldText.split('\n') : [];
  const newLines = newText.length ? newText.split('\n') : [];

  if (oldLines.length > EXACT_DIFF_LINE_CAP || newLines.length > EXACT_DIFF_LINE_CAP) {
    // Coarse fallback: count line-content differences via frequency
    // maps instead of position-aware LCS. Overcounts a pure reorder as
    // changed lines, which a real diff wouldn't — an acceptable
    // trade-off only past the cap above, where exactness isn't worth
    // the O(n*m) cost.
    const oldCounts = new Map<string, number>();
    for (const line of oldLines) oldCounts.set(line, (oldCounts.get(line) ?? 0) + 1);
    const newCounts = new Map<string, number>();
    for (const line of newLines) newCounts.set(line, (newCounts.get(line) ?? 0) + 1);

    let removed = 0;
    for (const [line, count] of oldCounts) {
      removed += Math.max(0, count - (newCounts.get(line) ?? 0));
    }
    let added = 0;
    for (const [line, count] of newCounts) {
      added += Math.max(0, count - (oldCounts.get(line) ?? 0));
    }
    return { added, removed };
  }

  const n = oldLines.length;
  const m = newLines.length;
  // Standard LCS length table, single Int32Array-backed 2D grid to keep
  // this cheap at the cap size (2000x2000 worst case is ~16MB as a flat
  // typed array, fine for a one-off click-triggered computation).
  const lcs = new Int32Array((n + 1) * (m + 1));
  const idx = (i: number, j: number) => i * (m + 1) + j;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      lcs[idx(i, j)] = oldLines[i - 1] === newLines[j - 1]
        ? lcs[idx(i - 1, j - 1)] + 1
        : Math.max(lcs[idx(i - 1, j)], lcs[idx(i, j - 1)]);
    }
  }

  const common = lcs[idx(n, m)];
  return { added: m - common, removed: n - common };
}

/**
 * Client-side stand-in for the backend's
 * `CompletionController::getProtectedPaths()`, which isn't exposed
 * through any endpoint today. This is deliberately conservative (a
 * short list of near-universally-scaffold filenames across the
 * supported frameworks) rather than exhaustive — good enough to catch
 * the obvious "AI tried to hand me a new package.json" case in THIS
 * chat-based proof of G2a, but NOT a substitute for the real,
 * framework-aware list once G2b wires this screen into
 * `generate()`'s actual AI-scaffold-merge path. Flagged in
 * PLAN_SYSTEM_TASKS.md as a follow-up: expose `getProtectedPaths()`
 * (or an equivalent) via API so this list has one real source of truth
 * instead of two that can drift apart.
 */
const COMMON_PROTECTED_BASENAMES = new Set([
  'ubiq.json',
  'package.json',
  'vite.config.js',
  'vite.config.ts',
  'tsconfig.json',
  'index.html',
  '.gitignore',
  'composer.json',
  'artisan',
]);

export function isLikelyProtectedPath(path: string): boolean {
  const basename = path.split('/').pop() ?? path;
  return COMMON_PROTECTED_BASENAMES.has(basename);
}
