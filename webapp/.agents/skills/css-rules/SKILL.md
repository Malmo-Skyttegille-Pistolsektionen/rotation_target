---
name: css-rules
description: Use this skill when writing any css styling
---

### CSS Modules

- Use camelCase for class names
- Use `clsx` for conditional classes
- NO global CSS except in index.css

```typescript
import clsx from 'clsx';
import styles from './Component.module.css';

<div className={clsx(styles.container, isActive && styles.active)} />
