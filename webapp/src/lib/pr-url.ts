/**
 * The no-token route back onto GitHub for a program authored on the Pages
 * editor (#140): a prefilled `/new/<branch>` URL. The user lands in GitHub's
 * own file editor, already signed in, and commits through the normal flow -
 * which forks the repo and opens the pull request for them if they lack
 * write access. No token ever touches this app.
 *
 * `filename` and `value` are GitHub's longstanding, documented way to
 * prefill a new file. `message` and `description` (commit title and
 * extended description) are not documented for this endpoint, so this seeds
 * them optimistically and the caller shows the same text next to the link
 * with a copy button - the fallback the issue calls "dull and fine" for when
 * GitHub does not honour them.
 */
import { programFilename } from './download';

export const PROGRAMS_PATH = 'resources/programs/files';

/**
 * Browsers and GitHub both cap a URL in practice around 8 KB (#140). This
 * stays comfortably under that so `filename`, `value`, `message` and
 * `description` together still fit once GitHub's own URL scaffolding is
 * added.
 */
export const NEW_FILE_URL_BUDGET_BYTES = 8_000;

export interface PrContext {
  id: number;
  title: string;
  /** Where the document being sent came from - a repo file, a local file, or new. */
  origin: string;
}

/** Conventional Commits, since `check-semantic-pr.yml` lints every PR title on this repo, including this one. */
export function prCommitMessage(ctx: PrContext): string {
  return `feat(programs): add program ${String(ctx.id)} — ${ctx.title}`;
}

/**
 * The line the issue insists on: a program authored here has never run on a
 * board, and the pull request is the only place that can say so.
 */
export function prDescription(ctx: PrContext): string {
  return [
    `Program ${String(ctx.id)} — "${ctx.title}".`,
    '',
    `Opened from: ${ctx.origin}.`,
    '',
    'Authored in the Pages program editor, with no device attached, and has ' +
      'not been run on a target. Verify it on a physical range before treating ' +
      'it as reviewed.',
  ].join('\n');
}

export interface NewFileUrl {
  url: string;
  byteLength: number;
  /** True when `url` would exceed the practical cap and should not be offered as a link. */
  overBudget: boolean;
}

/**
 * The prefilled `/new/main` URL for `owner/repo`. `json` is the exact text to
 * commit - not re-derived from `ctx`, so a hand-edited JSON tab is what gets
 * sent, same as Download.
 */
export function buildNewFileUrl(owner: string, repo: string, json: string, ctx: PrContext): NewFileUrl {
  const params = new URLSearchParams({
    filename: `${PROGRAMS_PATH}/${programFilename(ctx.id)}`,
    value: json,
    message: prCommitMessage(ctx),
    description: prDescription(ctx),
  });
  const url = `https://github.com/${owner}/${repo}/new/main?${params.toString()}`;
  const byteLength = new TextEncoder().encode(url).length;
  return { url, byteLength, overBudget: byteLength > NEW_FILE_URL_BUDGET_BYTES };
}
