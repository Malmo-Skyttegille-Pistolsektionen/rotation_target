To verify new changes run `yarn lint` and `yarn build`

## special files and directories
```
vite-plugins/mock-server-v2.ts    # Custom Vite plugin for mock server. SSE, rest, etc
```

**IMPORTANT: When making changes to v2 API make sure that `docs/server-spec.md` is up to date and correct.**

## Do Not

- Edit files in `src_legacy/`, `legacy.html`, or `vite-plugins/mock-server.ts`. These are a snapshot of the v1 implementation.
- Use Tailwind CSS
