/**
 * Hand the browser a file to save.
 *
 * The whole promotion path for a program authored on the device is "get the
 * document off it, commit it to resources/programs/files/, review it as a PR" -
 * and until now the only way off was select-all in the JSON tab. That is worst
 * for the long programs most worth promoting.
 */
export function downloadJson(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked on the next turn, not immediately: the click is queued, and
  // revoking a URL the browser has not fetched yet cancels the download.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

/**
 * The name a downloaded program takes.
 *
 * `<id>.json`, because that is the name it must have under
 * `resources/programs/files/` - so promotion is "download, drop in, commit"
 * with no rename step to get wrong.
 */
export function programFilename(id: number): string {
  return `${String(id)}.json`;
}
