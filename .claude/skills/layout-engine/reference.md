# JSimpleLayout — Technical Reference

## File Structure

```
src/lib/
  types.ts                  — public type definitions (Tab, StackNode, SplitNode, LayoutNode, etc.)
  tree.ts                   — pure tree algorithms, no Svelte dependency (~270 lines)
  LayoutState.svelte.ts     — reactive Svelte 5 state class (~330 lines)
  LayoutArea.svelte         — renderer component with snippets + scoped CSS (~280 lines)
  index.ts                  — public API barrel export
demo/
  src/routes/+page.svelte   — demo app with colored placeholder panels
```

---

## Tree Model

### Types (`types.ts`)

```typescript
type Tab = {
	id: string;
	title: string;
	contentType: string;        // arbitrary — consumer defines meaning
	props?: Record<string, any>; // optional data for the content renderer
};

type StackNode = {
	type: 'stack';
	id: string;
	tabs: Tab[];
	activeTab: number;  // index into tabs[]
	size: number;       // flex ratio relative to siblings (0–1)
};

type SplitNode = {
	type: 'row' | 'column';
	id: string;
	children: LayoutNode[];
	size: number;
};

type LayoutNode = StackNode | SplitNode;

type DropSide = 'top' | 'bottom' | 'left' | 'right' | 'center';
```

### Serialization Types

```typescript
interface LayoutDocument {
	version: 1;
	name?: string;
	tree: SerializedNode;
}

interface SerializedNode {
	type: 'row' | 'column' | 'stack';
	size: number;
	children?: SerializedNode[];
	tabs?: SerializedTab[];
	activeTab?: number;
}

interface SerializedTab {
	title: string;
	contentType: string;
	props?: Record<string, any>;
}
```

IDs are runtime-only (for DOM keying). `serialize()` strips them; `deserialize()` regenerates fresh ones.

---

## Pure Tree Algorithms (`tree.ts`)

All functions are pure — no Svelte dependency, independently testable.

### Traversal

```typescript
findParent(node, targetId) → [SplitNode, childIndex] | null
findStack(node, id) → StackNode | null
findSplit(node, id) → SplitNode | null
findFirstStack(node) → StackNode | null
findStackByContentType(node, contentType) → StackNode | null
```

### Mutations

```typescript
addTabToStack(root, stackId, tab, insertIdx?) → boolean
removeTabFromStack(root, stackId, tabIdx) → Tab | null
reorderTab(root, stackId, fromIdx, toIdx) → boolean
splitStack(root, stackId, tab, side) → LayoutNode  // returns new root
```

### Cleanup

```typescript
cleanup(node) → LayoutNode | null
cloneTree(node) → LayoutNode
```

`cleanup()`:
1. Prunes stacks with 0 tabs (returns null)
2. Collapses single-child splits (child absorbs parent's size)
3. Normalizes sibling sizes to sum to 1.0

`cloneTree()`: deep-copies the entire tree — **required** after cleanup to force Svelte reactivity.

### Hit-Testing

```typescript
hitTestDropZone(root, x, y, excludeStackId?, container?, edgeThreshold?) → { stackId, side } | null
```

Queries `[data-stack-id]` elements scoped to `container` (defaults to `document`). If cursor is over a target's `[data-jsl-tab-bar]`, forces `side: 'center'` (tab-bar-to-merge). Otherwise: 22% edge threshold for splits, center for merge. The `container` parameter enables nested layout isolation — each `LayoutArea` passes its root element so queries never escape its subtree.

### Serialization

```typescript
serialize(root, name?) → LayoutDocument
deserialize(doc) → LayoutNode
```

---

## LayoutState (`LayoutState.svelte.ts`)

Reactive Svelte 5 state class. All public API methods.

### State

```typescript
class LayoutState {
	root = $state<LayoutNode>(...);           // the layout tree
	activeStackId = $state<string | null>(null); // focused stack
	dragging = $state<DragState | null>(null);   // tab drag state
	dropZone = $state<DropZone | null>(null);    // current drop target
	resizing = $state<ResizeState | null>(null);  // resize handle state
	containerEl: HTMLElement | null = null;       // DOM scope (set by LayoutArea)
}
```

### Public API

| Method | Purpose |
|---|---|
| `addTab(stackId, tab, idx?)` | Add a tab to a specific stack |
| `removeTab(stackId, tabIdx)` | Remove a tab (cleanup + clone) |
| `addTabAnywhere(tab)` | Add to the first available stack |
| `closeStack(stackId)` | Close area, transfer tabs to nearest stack |
| `split(stackId, tab, side)` | Split a stack on an edge |
| `maximize(stackId)` | Store layout, show single stack |
| `restore()` | Restore pre-maximize layout |
| `isMaximized` (getter) | Whether currently maximized |
| `findContentType(type)` | Find stack with given content type |
| `focusContent(type)` | Focus + activate tab by content type |
| `serialize(name?)` | Export layout as JSON document |
| `load(doc)` | Import layout from JSON document |
| `setLayout(layout)` | Replace entire tree |
| `LayoutState.createTab(title, type, props?)` | Static helper to create a tab with auto-ID |

### Pointer Event Handlers

Wire to `<svelte:window>`:

```typescript
handlePointerMove(e: PointerEvent)  // resize + tab drag + reorder
handlePointerUp()                   // commit drag/resize
```

### Internal Methods (called by LayoutArea)

```typescript
startTabDrag(e, tab, stackId, tabIdx)   // begins tab drag
startResize(e, parentNode, childIdx, parentEl)  // begins resize
activateTab(stackId, tabIdx)            // sets active tab + fires callback
```

### Callbacks

```typescript
onActiveStackChange?: (stackId: string, contentType: string) => void
```

---

## LayoutArea (`LayoutArea.svelte`)

Recursive renderer component. Takes a `LayoutState` and consumer snippets.

### Props

| Prop | Type | Required | Default | Purpose |
|---|---|---|---|---|
| `layout` | `LayoutState` | Yes | — | The reactive state instance |
| `renderContent` | `(tab, stack) => any` | Yes | — | Renders area content |
| `renderTabIcon` | `(tab) => any` | No | — | Icon in tab bar corner |
| `renderDragGhost` | `(tab, x, y) => any` | No | default ghost | Custom drag ghost |
| `class` | `string` | No | `''` | Extra CSS classes on root |
| `tabBarHeight` | `number` | No | `32` | Tab bar height in px |
| `resizeHandleSize` | `number` | No | `4` | Visible handle thickness in px |
| `resizeHitSize` | `number` | No | `resizeHandleSize + 4` | Invisible grab area in px |

### Rendering Pattern

Recursive `{#snippet}` blocks:
- `layoutNode(node)` — dispatches to splitPanel or stackPanel
- `splitPanel(node)` — flex container + resize handles + recurse children
- `stackPanel(node)` — tab bar + content + maximize/close buttons + drop zone overlay

### Data Attributes (for hit-testing)

| Attribute | Element | Purpose |
|---|---|---|
| `data-stack-id` | Stack root div | Drop zone + reorder target identification |
| `data-split-id` | Split root div | Resize handle parent lookup |
| `data-jsl-tab-bar` | Tab bar div | Reorder + tab-bar-merge detection |
| `data-jsl-tab-idx` | Individual tab div | Midpoint-based reorder targeting |

### Area Controls

Each stack has maximize (□/▪) and close (×) buttons in the top-right corner of the tab bar. Invisible by default, fade in on stack hover. Maximize stores/restores layout. Close transfers tabs to nearest stack.

### CSS Theming

14 custom properties on `.jsl-root`:

```css
--jsl-bg: #262626;
--jsl-surface: #171717;
--jsl-border: #404040;
--jsl-text: #e5e5e5;
--jsl-text-muted: #a3a3a3;
--jsl-text-dim: #737373;
--jsl-accent: #3b82f6;
--jsl-accent-bg: rgba(59, 130, 246, 0.2);
--jsl-accent-border: rgba(96, 165, 250, 0.6);
--jsl-handle-bg: #404040;
--jsl-handle-hover: rgba(59, 130, 246, 0.6);
--jsl-tab-active-bg: #262626;
--jsl-tab-hover-bg: rgba(38, 38, 38, 0.5);
```

All structural classes prefixed `.jsl-*` for targeted overrides.

---

## Tab Drag + Reorder System

### Unified Pointer Flow

```
pointerdown on tab → startTabDrag()
  records: tab, sourceStackId, sourceTabIdx, startX/Y
  sets active = false

pointermove (window) → handlePointerMove()
  if |dx|+|dy| > 5 → active = true (activation threshold)
  if active:
    1. _hitTestTabReorder(x, y) — is cursor in source stack's tab bar?
       YES → reorder mode: swap tabs at midpoint, clear dropZone
       NO  → cross-stack mode: hitTestDropZone() → update dropZone

pointerup (window) → handlePointerUp()
  if active && dropZone:
    1. Remove tab from source
    2. cleanup() ← clean empty source BEFORE splitting
    3. Re-find target by ID (may have moved after collapse)
    4. center → addTabToStack / edge → splitStack
    5. _cleanupAndApply() ← final cleanup + cloneTree
  clear all drag state
```

### Reorder Hit-Test (`_hitTestTabReorder`)

1. Find source stack element via `[data-stack-id]` scoped to `containerEl`
2. Find its `[data-jsl-tab-bar]` child
3. Check cursor Y is within tab bar bounds (±8px tolerance)
4. Query `[data-jsl-tab-idx]` elements, find midpoint crossing
5. Return target index (or null if outside tab bar)

### Tab-Bar-to-Merge

When dragging over a *different* stack's tab bar, `hitTestDropZone` detects `[data-jsl-tab-bar]` and forces `side: 'center'`. This makes dropping on another stack's tab bar always merge — no accidental top-edge splits.

---

## Consumer Usage

```svelte
<script>
  import { LayoutState, LayoutArea } from 'jsimplelayout';
  import type { Tab, StackNode } from 'jsimplelayout';

  const layout = new LayoutState(myInitialTree);
</script>

<LayoutArea {layout}>
  {#snippet renderContent(tab: Tab, stack: StackNode)}
    {#if tab.contentType === 'editor'}
      <CodeEditor />
    {:else if tab.contentType === 'terminal'}
      <Terminal />
    {:else}
      <FileBrowser />
    {/if}
  {/snippet}

  {#snippet renderTabIcon(tab: Tab)}
    <span class="icon">{iconMap[tab.contentType]}</span>
  {/snippet}
</LayoutArea>
```

---

## Traps & Invariants

### Trap: Svelte 5 deep-tree reactivity (ghost panels)

**Problem**: `cleanup()` returns the same root reference. `root = cleaned` is `root = root` — `Object.is()` no-op. DOM retains ghost panels.

**Fix**: Always `cloneTree()` after cleanup. `_cleanupAndApply()` does this internally.

**Rule**: NEVER do `this.root = cleanup(this.root)`. The `LayoutState` methods handle this — don't bypass them with direct tree mutation.

### Trap: Premature size mutation in splitStack

**Problem**: `target.size = 0.5` before reading it for the wrapper → wrapper gets 0.5 instead of original.

**Fix**: `const originalSize = target.size` before any mutation. Wrapper gets `originalSize`.

**Rule**: Read-then-write, never write-then-read.

### Trap: Stale nodes during multi-step mutations

**Problem**: Tab drag does remove + split. Empty source still in tree during split → size rebalancing includes ghost.

**Fix**: Cleanup between remove and split. Re-find target by ID after cleanup.

**Rule**: Never let `splitStack` operate on a tree containing empty nodes.

### Trap: Size normalization drift

**Problem**: After removing children, sizes don't sum to 1.0. Compounds over repeated operations.

**Fix**: `cleanup()` normalizes sizes after every filter.

### Trap: `{@const}` placement in Svelte 5

**Problem**: `{@const}` must be the immediate child of `{#snippet}`, `{#if}`, `{#each}`, etc. — NOT inside a raw `<div>`. Causes compile error.

**Fix**: Hoist all `{@const}` declarations to the snippet level, before the first `<div>`.

---

## Nested / Recursive Layouts

Multiple `LayoutState` instances can coexist. Each `LayoutArea` sets `layout.containerEl` to its root DOM element on mount (cleaned up on destroy). All DOM queries in `hitTestDropZone()` and `_hitTestTabReorder()` are scoped to this container, so inner layouts never interfere with outer ones.

**How it works:**
- `LayoutArea` uses `bind:this` on `.jsl-root` and sets `layout.containerEl` in `onMount`
- `hitTestDropZone(root, x, y, exclude, container)` queries `(container ?? document).querySelectorAll('[data-stack-id]')`
- `_hitTestTabReorder()` queries `(this.containerEl ?? document).querySelector('[data-stack-id=...]')`
- Window-level pointer events (`<svelte:window>`) fire for all instances but only the instance with active `dragging`/`resizing` state responds

**Usage:**
```svelte
<!-- Outer layout -->
<LayoutArea layout={outerLayout}>
  {#snippet renderContent(tab, stack)}
    {#if tab.contentType === 'nested-module'}
      <!-- Inner layout — fully independent -->
      <LayoutArea layout={innerLayout}>
        {#snippet renderContent(innerTab, innerStack)}
          ...
        {/snippet}
      </LayoutArea>
    {/if}
  {/snippet}
</LayoutArea>
```

---

## Extended Resize Hitbox

The resize handle has separate visual and grab dimensions to make thin separators easy to grab.

- `resizeHandleSize` (default 4px) — visible line thickness, rendered via `::after` pseudo-element
- `resizeHitSize` (default `resizeHandleSize + 4`) — actual element width (the grab target)
- Negative margins (`margin-inline` / `margin-block`) reclaim the extra space so layout contribution equals `resizeHandleSize`
- The element itself is `background: transparent`; only the `::after` pseudo is visible
- Zero layout shift — adjacent panels don't lose a pixel

**CSS custom properties (set inline per handle):**
- `--jsl-hit` — grab area size
- `--jsl-vis` — visible line size
- Margin: `calc((var(--jsl-vis) - var(--jsl-hit)) / 2)` (negative, reclaims space)

---

### General invariant: no empty space

1. Every split has ≥2 children (cleanup collapses single-child splits)
2. Every stack has ≥1 tab (cleanup removes empty stacks, `closeStack` transfers tabs)
3. Sibling sizes always sum to ~1.0 (normalized after every mutation)
4. The root is always a valid node (fallback to empty stack if cleanup returns null)
5. The DOM always reflects the current tree state (clone after structural changes)
