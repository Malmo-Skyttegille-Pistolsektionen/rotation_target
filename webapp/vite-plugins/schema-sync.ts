/**
 * Keeps `public/program.schema.json` byte-identical to the canonical
 * `contracts/program.schema.json`, so there is exactly one program schema
 * and it cannot silently drift.
 *
 * `public/program.schema.json` is gitignored: this plugin writes it fresh on
 * every `vite` (dev) and `vite build` run, before Vite copies `publicDir`
 * into `dist/`. The legacy program editor (`src_legacy`) fetches it at
 * runtime for ajv validation.
 */
import type { Plugin } from 'vite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, '../../contracts/program.schema.json');
const dest = path.resolve(here, '../public/program.schema.json');

function syncSchema(): void {
  if (!fs.existsSync(source)) {
    throw new Error(`schema-sync: canonical schema not found at ${source}`);
  }
  fs.copyFileSync(source, dest);
}

export function schemaSyncPlugin(): Plugin {
  return {
    name: 'schema-sync',
    buildStart() {
      // Once per dev-server start and once per build. Editing the canonical
      // schema while `vite` is running needs a restart to take effect - it is
      // outside the project root, so no watcher reaches it.
      syncSchema();
    },
  };
}
