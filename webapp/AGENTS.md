To verify new changes run `npm run lint`, `npm run test` and `npm run build`

## special files and directories
```
test/mock-server/                 # The v2 mock API: REST, SSE, simulation. Injectable clock
vite-plugins/mock-server-v2.ts    # Thin adapter mounting the above on the Vite dev server
src/lib/run-position.ts           # Mirrors firmware/lib/rt_logic/run_position.h - change both
```

**IMPORTANT: When making changes to v2 API make sure that `docs/server-spec.md` is up to date and correct.**

## Do Not

- Edit files in `src_legacy/`, `legacy.html`, or `vite-plugins/mock-server.ts`. These are a snapshot of the v1 implementation.
- Use Tailwind CSS
