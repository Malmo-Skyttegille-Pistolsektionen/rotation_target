# Agent Guidelines for Rotation Target Frontend

## Quick Reference

| Task            | Command       |
| --------------- | ------------- |
| Dev server      | `yarn dev`    |
| Build           | `yarn build`  |
| Lint            | `yarn lint`   |
| Format          | `yarn format` |
| Create dist zip | `yarn zip`    |

## Commands Detail

- **Dev Server:** `yarn dev` - Starts Vite on port 8080 with Mock Server
- **Build:** `yarn build` - Runs TypeScript check + Vite build to `dist/`
- **Lint:** `yarn lint` - ESLint with TypeScript and React rules
- **Format:** `yarn format` - Prettier formatting

**Note:** There are no tests configured. Build includes TypeScript type-checking.

## Tech Stack

- **Runtime:** Yarn 4 (node-modules linker)
- **Language:** TypeScript (strict mode enabled)
- **Framework:** React 19 with React Compiler (babel-plugin-react-compiler)
- **Routing:** TanStack Router (file-based routing)
- **Data Fetching:** TanStack Query
- **Styling:** CSS Modules (NO Tailwind CSS)
- **Utilities:** clsx for conditional classNames

## Project Structure

```
src/
  api/           # API client and type definitions
  components/    # Reusable components with colocated CSS modules
  context/       # React Context providers
  hooks/         # Custom React hooks
  routes/        # File-based routes (TanStack Router)
vite-plugins/    # Custom Vite plugins (mock server)
src_legacy/      # Legacy code (reference only, do not edit)
test/data/       # Mock data for development
plans/           # Implementation plans and specs
docs/            # API specs and changelogs
```

## Code Style

### Formatting (Prettier)

- Semicolons: required
- Tab width: 2 spaces
- Print width: 120 characters
- Single quotes for JS/TS
- Single quotes for JSX attributes
- Trailing commas: all

### File Naming

- Files: `kebab-case.tsx` or `kebab-case.ts`
- Components: `PascalCase` (function name)
- Hooks: `useCamelCase`
- Constants: `UPPER_CASE`

### TypeScript

- Strict mode enabled
- No unused locals/parameters (error)
- No fallthrough in switch cases
- Use explicit types for function parameters
- Prefer `interface` for object shapes, `type` for unions/intersections
- Use `type` imports where possible: `import type { X } from 'y'`

### Imports Order

1. External libraries (react, tanstack, etc.)
2. Internal absolute imports (if configured)
3. Relative imports (../api, ./components)
4. CSS modules last

Example:

```typescript
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { programsApi } from '../api/programs';
import type { Program } from '../api/types';
import styles from './component.module.css';
```

### React Components

- Functional components only
- Use React Compiler (automatic memoization)
- Colocate CSS modules with components

```typescript
// Good: ComponentName.tsx + ComponentName.module.css
import styles from './ComponentName.module.css';

interface ComponentNameProps {
  value: string;
  onChange: (value: string) => void;
}

export function ComponentName({ value, onChange }: ComponentNameProps): React.ReactNode {
  return <div className={styles.container}>{value}</div>;
}
```

### State Management

| State Type   | Solution                        |
| ------------ | ------------------------------- |
| Server state | TanStack Query                  |
| URL state    | TanStack Router (search params) |
| Local state  | useState / useReducer           |
| Global UI    | React Context (sparingly)       |

### Data Fetching Pattern

```typescript
// Query with TanStack Query
const { data, isLoading, error } = useQuery({
  queryKey: ['programs'],
  queryFn: programsApi.list,
});

// Mutation with cache invalidation
const mutation = useMutation({
  mutationFn: programsApi.load,
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['status'] });
  },
});
```

### CSS Modules

- Use camelCase for class names
- Use `clsx` for conditional classes
- NO global CSS except in index.css

```typescript
import clsx from 'clsx';
import styles from './Component.module.css';

<div className={clsx(styles.container, isActive && styles.active)} />
```

### Error Handling

- API errors throw with descriptive messages
- Use try/catch for JSON parsing in event handlers
- Log errors to console with context prefix

```typescript
try {
  const data = JSON.parse(e.data);
} catch (error) {
  console.error('[SSE] Failed to parse:', error);
}
```

## API Integration

- API clients are in `src/api/`
- Base URL: `http://localhost:8080/api/v2`
- SSE endpoint: `/sse/v2`
- All API functions are typed

Key API modules:

- `src/api/client.ts` - Base fetch wrapper with admin auto-enable
- `src/api/programs.ts` - Program CRUD and control
- `src/api/types.ts` - Shared types and SSE event types

### Admin Auto-Enable

`client.ts` automatically handles admin authentication:

1. Request to `/api/v2/*` returns 401
2. Client calls `POST /admin-mode/enable` with password
3. Retries original request with new token

Token stored as cookie, not persisted across page reloads.

### SSE Data Flow

```
Server state change
       │
       ▼
SSE stateUpdate event (/sse/v2)
       │
       ▼
useSSE hook (src/hooks/useSSE.ts)
       │
       └──► queryClient.setQueryData(['state'], data)
              │
              ▼
         Components re-render via useQuery(['state'])
```

### Query Keys

| Key               | Source | Description                             |
| ----------------- | ------ | --------------------------------------- |
| `['state']`       | SSE    | Real-time program state (set by useSSE) |
| `['programs']`    | REST   | Program list                            |
| `['program', id]` | REST   | Single program details                  |
| `['sse-status']`  | SSE    | Connection status                       |

## Mock Server

Located at `vite-plugins/mock-server.ts`. Provides:

- REST API endpoints at `/api/v1/*`
- SSE endpoint at `/sse/v1`
- Program simulation with events
- Admin mode authentication

**Keep mock server updated when API contracts change.**

## Mock Server v2

Located at `vite-plugins/mock-server-v2.ts`. SSE-first architecture for new React app.

- REST API endpoints at `/api/v2/*`
- SSE endpoint at `/sse/v2`
- Single `stateUpdate` event for all state changes

**IMPORTANT: When making changes to v2 API, always update:**

- `docs/server-spec.md` - Endpoint and behavior specification
- `docs/server-changelog.md` - Delta vs v1 for production porting

## ESLint Rules

- React hooks rules (recommended)
- React Compiler plugin (error level)
- TypeScript recommended rules
- Unused vars: warning
- No React import required (react-in-jsx-scope: off)

## UI/UX Guidelines

- **Primary target:** Tablets (landscape/portrait)
- **Must support:** Mobile devices
- Touch-friendly controls (large buttons)
- Responsive layouts (flexbox/grid)

## Migration Notes

The project is migrating from legacy code in `src_legacy/`.

**Completed:**

- Yarn 4 setup
- React 19 + TypeScript setup
- TanStack Router setup

**In Progress:**

- UI component migration
- API integration
- Legacy cleanup

## Do Not

- Edit files in `src_legacy/` unless fixing critical bugs
- Use Tailwind CSS
- Use class components
- Create global CSS (use CSS modules)
- Skip TypeScript types
