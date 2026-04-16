# JSimpleLayout — Ship Plan

Minimal GoldenLayout-style dynamic panel layout engine for Svelte 5.
Zero dependencies. ~500 lines. Pure pointer events.

## What's Done

### Core engine (extracted, tested in JExplore testbed)
- [x] Tree model: `row` / `column` / `stack` recursive layout nodes
- [x] Tab drag between stacks (pointer events, 5px activation threshold)
- [x] Drop zone hit-testing (22% edge = split, center = add to stack)
- [x] Directional splitting (same-direction insert, cross-direction wrap, root wrap)
- [x] Resize handles between siblings (flex ratio adjustment)
- [x] Tab close with auto-cleanup/collapse
- [x] Size normalization (children always sum to 1.0)
- [x] Clone-on-mutation pattern (Svelte 5 deep reactivity fix)
- [x] Cleanup-before-split (stale node prevention)
- [x] Serialization / deserialization (JSON round-trip)
- [x] `LayoutState` class (reactive state manager)
- [x] Type exports

### Architecture
- [x] `types.ts` — all public types
- [x] `tree.ts` — pure functions, no Svelte dependency (testable anywhere)
- [x] `LayoutState.svelte.ts` — reactive Svelte 5 state class
- [x] `index.ts` — clean public API

## What's Needed for v0.1 (MVP)

### Must Have
- [x] **`LayoutArea.svelte`** — the renderer component. Recursive snippets for split/stack.
      Consumer passes a `renderContent` snippet that receives `(tab, stack)` and renders
      whatever they want inside the area. Also accepts `renderTabIcon` and `renderDragGhost`.
- [x] **Basic CSS** — ships a minimal default stylesheet (dark theme) via `<style>`.
      Consumers can override with CSS custom properties (`--jsl-*`) or target `.jsl-*` classes.
- [x] **Tab reorder within a stack** — drag a tab left/right in the same tab bar.
      Cursor in tab bar = reorder mode (swap at midpoint). Cursor leaves bar = cross-stack drag.
      Dragged tab shown at 40% opacity. `data-tab-bar` + `data-tab-idx` attrs for hit-testing.
- [ ] **Demo page** — standalone SvelteKit app with colored placeholder panels.
      Acts as both documentation and visual test. Port from JExplore testbed.

### Should Have (v0.1 polish)
- [ ] **Double-click tab bar to maximize/restore** — common UX pattern.
- [ ] **Min size constraints** — pixel floor per area (e.g. 80px min).
      Currently 5% flex minimum, which can be too small on large screens.
- [ ] **`onlayoutchange` callback** — fires after any structural change.
      Consumers use this to auto-persist layouts.
- [ ] **Active stack tracking** — `activeStackId` updates on pointer interaction.
      Fires `onActiveStackChange(stackId, contentType)` for keyboard routing.

### Nice to Have (v0.2+)
- [ ] **Workspace presets** — named layout snapshots, save/load from JSON.
- [ ] **Headless mode** — use `tree.ts` without Svelte (React adapter, vanilla JS).
- [ ] **Tab overflow menu** — when too many tabs to fit, show a dropdown.
- [ ] **Animated transitions** — smooth split/collapse with CSS transitions.
- [ ] **Accessibility** — ARIA roles, keyboard tab navigation.
- [ ] **RTL support** — flip row direction for right-to-left layouts.

### Won't Do (out of scope)
- Edge-drag splitting (Blender complexity, low value)
- Floating/detached panels
- Nested tab bars
- Framework-agnostic core (Svelte 5 is the target)

## Known Traps (documented in JExplore skill)

These are bugs we already hit and fixed. Guard against regressions:

1. **Svelte 5 deep-tree reactivity**: `cleanup()` returns the same root reference.
   `root = cleanup(root)` is a no-op — `Object.is()` sees same ref, setter doesn't fire.
   **Fix**: Always `cloneTree()` after cleanup.

2. **Premature size mutation**: `splitStack` must save `originalSize` before setting
   `target.size = 0.5`. The wrapper needs the original, not 0.5.
   **Fix**: Read-then-write, never write-then-read.

3. **Stale nodes during multi-step mutations**: Tab drag does remove + split.
   Empty source must be cleaned out BEFORE `splitStack` runs, otherwise it
   participates in size rebalancing.
   **Fix**: Cleanup between each structural step. Re-find targets by ID after cleanup.

4. **Size normalization drift**: After removing children, sizes don't sum to 1.0.
   **Fix**: Normalize in `cleanup()` after every filter.

## File Structure

```
JSimpleLayout/
  src/lib/
    types.ts                  — public type definitions
    tree.ts                   — pure tree algorithms (no Svelte)
    LayoutState.svelte.ts     — reactive state class
    LayoutArea.svelte         — renderer component (snippet-based, themeable)
    index.ts                  — public API exports
  package.json
  PLAN.md                     — this file
```

## API Surface

```typescript
import { LayoutState } from 'jsimplelayout';

// Create
const layout = new LayoutState(initialTree);

// Tabs
layout.addTab(stackId, tab);
layout.removeTab(stackId, tabIdx);
layout.addTabAnywhere(tab);
LayoutState.createTab('Files', 'explorer');

// Splitting
layout.split(stackId, tab, 'right');

// Maximize
layout.maximize(stackId);
layout.restore();

// Persistence
const doc = layout.serialize('My Layout');
layout.load(doc);

// Wire to window events
<svelte:window
  onpointermove={layout.handlePointerMove.bind(layout)}
  onpointerup={layout.handlePointerUp.bind(layout)}
/>

// Render
<LayoutArea {layout}>
  {#snippet renderContent(tab)}
    {#if tab.contentType === 'editor'}
      <CodeEditor />
    {:else}
      <FileBrowser />
    {/if}
  {/snippet}
</LayoutArea>
```

## Size Budget

| Component | Lines | Minified (est.) |
|---|---|---|
| types.ts | ~60 | 0 (types only) |
| tree.ts | ~250 | ~4KB |
| LayoutState.svelte.ts | ~250 | ~4KB |
| LayoutArea.svelte | ~240 (template + scoped CSS) | ~5KB |
| **Total** | **~800** | **~13KB** |

Zero dependencies. Peer dep: `svelte ^5.0.0`.
