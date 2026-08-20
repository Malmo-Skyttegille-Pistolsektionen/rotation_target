To verify changes run `npm run typecheck`, `npm run lint`, `npm run test` and
`npm run build`. The full E2E suite drives the real firmware in QEMU:
`npm run e2e:local` (needs ESP-IDF; see `../firmware/docs/QEMU.md`). CI enforces
all of these plus a gzip size budget (`size-budget`, bytes — regeneration
command in `README.md`).

## API contract

`../contracts/` is canonical: `openapi.yaml`, `asyncapi.yaml`,
`program.schema.json`. Contract changes land in `contracts/` in the same PR as
the implementation.

- `src/api/generated.d.ts` is generated — run `npm run generate:api` after any
  contract change; CI fails on drift. `src/api/types.ts` hand-writes the SSE
  types and re-exports the REST ones from the generated file.
- `public/program.schema.json` is synced byte-for-byte from `contracts/` at
  build time — never edit it (a dev-server restart picks up contract edits).

## Special files and directories

```
test/mock-server/                 # The v2 mock API: REST, SSE, simulation. Injectable clock
vite-plugins/mock-server-v2.ts    # Thin adapter mounting the above on the Vite dev server
src/lib/run-position.ts           # Mirrors firmware/lib/rt_logic/run_position.h - change both
e2e/                              # Playwright suite against the QEMU-hosted firmware (D-17)
```

## Do Not

- Edit files in `src_legacy/`, `legacy.html`, or `vite-plugins/mock-server.ts`.
  These are a snapshot of the v1 implementation — and `src_legacy` is
  load-bearing: the Programs tab exists nowhere else. (The Audios tab is
  ported, at `src/routes/audios.tsx`; the legacy one stays until Programs is
  ported too.)
- Use Tailwind CSS
