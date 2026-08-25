/**
 * Hand the browser a file to save.
 *
 * The whole promotion path for a program authored on the device is "get the
 * document off it, commit it to resources/programs/files/, review it as a PR" -
 * and until now the only way off was select-all in the JSON tab. That is worst
 * for the long programs most worth promoting.
 */
export function downloadJson(filename: string, text: string): void {
  downloadBlob(filename, new Blob([text], { type: 'application/json' }));
}

/**
 * The same, for bytes that came from the device rather than from this app —
 * the troubleshooting bundle (#201).
 */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
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

/**
 * Today's date, inserted before the extension.
 *
 * The device names the bundle it serves, and the name has no date in it
 * because the device has no clock — it never learns one. The browser does, so
 * the half of the name only this side knows goes on here. Local date, not UTC:
 * it is read by somebody standing in the same timezone as the board.
 */
export function datedFilename(filename: string, now: Date): string {
  const stamp = [
    String(now.getFullYear()),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');

  const dot = filename.lastIndexOf('.');
  if (dot <= 0) return `${filename}-${stamp}`;
  return `${filename.slice(0, dot)}-${stamp}${filename.slice(dot)}`;
}
