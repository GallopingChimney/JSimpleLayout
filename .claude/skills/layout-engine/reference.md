# JSimpleLayout — Technical Reference

## File Structure

```
src/lib/
  types.ts                  — public type definitions (Tab, StackNode, SplitNode, LayoutNode, etc.)
  tree.ts                   — pure tree algorithms, no Svelte dependency (~360 lines)
  LayoutState.svelte.ts     — reactive Svelte 5 state class (~425 lines)
  LayoutArea.svelte         — renderer component with snippets + scoped CSS (~725 lines)
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

type DropZone = {
	stackId: string;
	side: DropSide;
	rootEdge?: boolean;  // true when targeting container edge for root-level docking
};
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
hitTestContainerEdge(container, x, y, threshold?) → 'top' | 'bottom' | 'left' | 'right' | null
```

`hitTestDropZone`: Queries `[data-stack-id]` elements scoped to `container` (defaults to `document`). If cursor is over a target's `[data-jsl-tab-bar]`, forces `side: 'center'` (tab-bar-to-merge). Otherwise: 22% edge threshold for splits, center for merge. The `container` parameter enables nested layout isolation — each `LayoutArea` passes its root element so queries never escape its subtree.

`hitTestContainerEdge`: Checks if the cursor is within `threshold` pixels (default 16) of the layout container edge. Returns the edge side or null. Used during drag to detect root-level docking intent — dropping near a container edge creates a full-width/height panel at the root level rather than splitting an individual stack.

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
| `removeStack(stackId)` | Remove stack and all its tabs (no redistribution) |
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
| `init()` | Fire `onTabAdded` for tabs present in the current tree (idempotent — call once after wiring callbacks) |

### Pointer Event Handlers

Wire to `<svelte:window>`:

```typescript
handlePointerMove(e: PointerEvent)  // resize + tab drag + reorder + root-edge docking
handlePointerUp()                   // commit drag/resize (including root-edge dock)
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
onAddTab?: (stackId: string) => void  // "+" button in tab bars ($state — can be set reactively)
onTabAdded?: (tab: Tab) => void       // fires when a tab's id is newly in the tree
onTabRemoved?: (tab: Tab) => void     // fires when a tab's id leaves the tree entirely
```

**Lifecycle hook semantics.** `onTabAdded` and `onTabRemoved` are diff-based: after every mutation, the live tab-id set is compared to the previous set. Only genuine lifecycle transitions fire events:

- Drag-drop (move between stacks) → no events (id persists across the operation).
- Tab close, `removeStack`, `closeStack` destroying all targets → `onTabRemoved`.
- `addTab`, `addTabAnywhere`, `split`, `load`, `setLayout` introducing a new id → `onTabAdded`.
- `maximize`/`restore` → no events (tabs preserved in `_savedLayout`).
- `activateTab`, resize, reorder-within-stack → no events (membership unchanged).

**Constructor does NOT fire events.** Initial tabs passed via `new LayoutState(initialLayout)` are tracked silently — the consumer hasn't wired callbacks yet. To bootstrap resources for an initial tree, call `init()` after wiring callbacks — or equivalently, construct empty and feed the tree through `setLayout()`:

```typescript
// Idiomatic:
const layout = new LayoutState(restoredTree);
layout.onTabAdded = (tab) => createResourcesFor(tab);
layout.onTabRemoved = (tab) => destroyResourcesFor(tab);
layout.init();   // fires onTabAdded for every tab in restoredTree, idempotent

// Equivalent:
const layout = new LayoutState();
layout.onTabAdded = (tab) => createResourcesFor(tab);
layout.onTabRemoved = (tab) => destroyResourcesFor(tab);
layout.setLayout(restoredTree);
```

**Timing guarantees.** Both `onTabAdded` and `onTabRemoved`:

1. **Fire synchronously** within the mutating method (or within `init()`), before the method returns. No microtasks, no scheduling.
2. **Fire after `this.root` has been reassigned** to the new tree. Callbacks can read `this.root`, call `findContentType()`, or walk the tree and see state consistent with the completed mutation.
3. **Fire exactly once per lifecycle transition.** Drag-drop, which moves a tab between stacks without changing its id, produces no events by design (see drag-identity rule below).

These guarantees are part of the API contract — consumers may rely on them. In particular, they enable the **pre-seed pattern** below.

**Use case: per-tab resource lifecycle.** Render code should be pure reads — creating objects like editors, connections, or subscriptions during render (`{@const x = getOrCreate(tab)}`) crashes when the derived re-evaluates during teardown with a stale/undefined tab. Create resources in `onTabAdded`, destroy in `onTabRemoved`, read them during render via a plain Map lookup.

### Pre-seed pattern for tab creation with initial state

The default `onTabAdded` path creates a resource with default state. For cases that need non-default initialization — cloning from a sibling tab, restoring from a URL, injecting preloaded data — pre-seed the consumer map **before** calling `addTab` / `split`:

```typescript
// Consumer side:
const resources = new Map<string, Resource>();

layout.onTabAdded = (tab) => {
    if (resources.has(tab.id)) return;      // pre-seeded — leave alone
    resources.set(tab.id, new Resource());   // default path
};
layout.onTabRemoved = (tab) => {
    resources.get(tab.id)?.destroy();
    resources.delete(tab.id);
};

// Opening a tab with special initial state:
function cloneTabFromSibling(stackId: string, sibling: Resource) {
    const tab = LayoutState.createTab('Cloned', 'my-type');
    resources.set(tab.id, sibling.clone());  // pre-seed BEFORE addTab
    layout.addTab(stackId, tab);             // onTabAdded fires sync → sees existing key → no-op
}
```

**Why this works:**
- `LayoutState.createTab` generates the tab id synchronously — the consumer has the id before the layout sees the tab.
- `onTabAdded` fires synchronously inside `addTab`, after `this.root` is updated.
- The handler's `if (resources.has(tab.id)) return` tolerates both paths with a single line.

**Why this pattern exists:** It keeps creation-payload APIs off the library surface. JSL never needs to know about consumer resource types, constructor signatures, or clone semantics. The library dispatches lifecycle events; the consumer owns state lifecycle; pre-seeding is the escape hatch for non-default initialization.

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
| `style` | `string` | No | `''` | Inline style on root (use for CSS custom property overrides) |
| `tabBarHeight` | `number` | No | `26` | Tab bar height in px |
| `resizeHandleSize` | `number` | No | `2` | Visible handle thickness in px |
| `resizeHitSize` | `number` | No | `10` | Invisible grab area in px |
| `onshiftclose` | `(stackId, tabs) => void` | No | — | Shift+click close callback (falls back to `layout.removeStack()`) |

### Rendering Pattern

Recursive `{#snippet}` blocks:
- `layoutNode(node)` — dispatches to splitPanel or stackPanel
- `splitPanel(node)` — flex container + resize handles + recurse children
- `stackPanel(node)` — tab bar (with overflow detection) + content + maximize/close buttons + drop zone overlay

### Data Attributes (for hit-testing)

| Attribute | Element | Purpose |
|---|---|---|
| `data-stack-id` | Stack root div | Drop zone + reorder target identification |
| `data-split-id` | Split root div | Resize handle parent lookup |
| `data-jsl-tab-bar` | Tab bar div | Reorder + tab-bar-merge detection |
| `data-jsl-tab-idx` | Individual tab div | Midpoint-based reorder targeting |

### Area Controls

Each stack has maximize and close buttons in the top-right corner of the tab bar. Invisible by default, fade in on stack hover. Maximize stores/restores layout. Close transfers tabs to nearest stack. The last remaining single-tab stack hides tab close buttons to prevent empty layouts.

### Tab Overflow

When tabs overflow the tab bar, a "..." button appears (detected by `ResizeObserver` + `MutationObserver` comparing `scrollWidth` vs `clientWidth`). Clicking opens a fixed-position dropdown listing all tabs with active-tab highlighting. The dropdown auto-closes on drag start or when overflow clears. Selecting a tab activates it and scrolls it into view.

### CSS Theming

13 custom properties on `.jsl-root` (+ 1 consumer-overridable with CSS fallback):

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
/* Consumer-overridable (not defined in root, uses fallback): */
/* --jsl-tab-icon-opacity: 0.7; */
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
       NO  → check container edges first:
             hitTestContainerEdge() → root-edge docking (dropZone.rootEdge = true)
             else → hitTestDropZone() → normal cross-stack drop zone

pointerup (window) → handlePointerUp()
  if active && dropZone:
    1. Remove tab from source
    2. cleanup() ← clean empty source BEFORE splitting
    3. If rootEdge:
       - Same direction as root → append/prepend to root children
       - Different direction or root is stack → wrap root in new split
    4. Else normal:
       - Re-find target by ID (may have moved after collapse)
       - center → addTabToStack / edge → splitStack
    5. _cleanupAndApply() ← final cleanup + cloneTree
  clear all drag state
```

### Reorder Hit-Test (`_hitTestTabReorder`)

1. Find source stack element via `[data-stack-id]` scoped to `containerEl`
2. Find its `[data-jsl-tab-bar]` child
3. Check cursor Y is within tab bar bounds (+/-8px tolerance)
4. Query `[data-jsl-tab-idx]` elements, find midpoint crossing
5. Return target index (or null if outside tab bar)

### Tab-Bar-to-Merge

When dragging over a *different* stack's tab bar, `hitTestDropZone` detects `[data-jsl-tab-bar]` and forces `side: 'center'`. This makes dropping on another stack's tab bar always merge — no accidental top-edge splits.

### Root-Edge Docking

When the cursor is within 16px of the layout container edge during a drag, `hitTestContainerEdge()` returns the edge side and the drop zone is set with `rootEdge: true`. On drop, the new stack is inserted at the root level (not as a child of any existing split), producing full-width/height docked panels. If the root split direction matches, the stack is appended/prepended; otherwise the entire root is wrapped in a new split.

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

- `resizeHandleSize` (default 2px) — visible line thickness, rendered via `::after` pseudo-element
- `resizeHitSize` (default 10px) — actual element width (the grab target)
- Negative margins (`margin-inline` / `margin-block`) reclaim the extra space so layout contribution equals `resizeHandleSize`
- The element itself is `background: transparent`; only the `::after` pseudo is visible
- Zero layout shift — adjacent panels don't lose a pixel

**CSS custom properties (set inline per handle):**
- `--jsl-hit` — grab area size
- `--jsl-vis` — visible line size
- Margin: `calc((var(--jsl-vis) - var(--jsl-hit)) / 2)` (negative, reclaims space)

---

### General invariant: no empty space

1. Every split has >=2 children (cleanup collapses single-child splits)
2. Every stack has >=1 tab (cleanup removes empty stacks, `closeStack` transfers tabs)
3. Sibling sizes always sum to ~1.0 (normalized after every mutation)
4. The root is always a valid node (fallback to empty stack if cleanup returns null)
5. The DOM always reflects the current tree state (clone after structural changes)
6. Last remaining single-tab stack hides close buttons (prevents empty layout)
