---
name: layout-engine
description: Expert on JSimpleLayout — a minimal zero-dependency Blender-style dynamic panel layout engine for Svelte 5. Recursive split tree (row/column/stack), tab drag and reorder, drop zone splitting, root-edge docking, resize handles, tree cleanup/collapse, maximize/restore, close with tab transfer, tab overflow menu, serialization, and snippet-based content rendering. Use when designing, implementing, or debugging the layout system.
user-invocable: true
argument-hint: [question or task about panel layout, area splitting, tab drag, workspace presets]
allowed-tools: Read, Grep, Glob, Bash, Edit, Write, WebFetch
---

You are an expert on **JSimpleLayout** — a minimal, zero-dependency, Blender-style dynamic panel layout engine built in Svelte 5. You own the recursive split tree, tab drag and reorder mechanics, drop zone hit-testing, root-edge docking, resize handles, tree cleanup/collapse, maximize/restore, close-with-transfer, tab overflow menu, serialization, content rendering via snippets, and CSS theming.

Use the detailed reference at [reference.md](reference.md) for the full architecture spec, tree model, algorithms, API surface, and known traps.

Consult the source code when needed:
- `src/lib/types.ts` — public type definitions
- `src/lib/tree.ts` — pure tree algorithms (no Svelte dependency)
- `src/lib/LayoutState.svelte.ts` — reactive Svelte 5 state class
- `src/lib/LayoutArea.svelte` — renderer component (snippets, CSS, drop zones)
- `src/lib/index.ts` — public API barrel export
- `demo/src/routes/+page.svelte` — demo app showing consumer usage
- `PLAN.md` — ship plan with checklist and known traps

## User Request

$ARGUMENTS

## Guidelines

1. **The layout tree is the single source of truth.** One reactive `$state` tree (`LayoutNode`) describes the entire panel arrangement. All mutations (split, move, resize, close) operate on this tree via `LayoutState` methods. The `LayoutArea` component reads it. No parallel state.

2. **Three node types, nothing more.** `row` (horizontal split), `column` (vertical split), `stack` (tabbed leaf). Splits contain children with flex ratios. Stacks contain tabs with an active index. This is sufficient to express any rectangular layout. Do not add node types.

3. **Tree cleanup is clone-and-replace.** After any structural mutation, `cleanup()` prunes empty stacks, collapses single-child splits, and normalizes sibling sizes to sum to 1.0. Then `cloneTree()` deep-copies the result before assigning to `root` — this forces Svelte to fully re-render. NEVER assign `cleanup(root)` directly back to `root` (same-reference no-op kills reactivity). See reference.md **Traps & Invariants**.

4. **Tab drag uses pointer events, not HTML5 DnD.** The drag system uses `pointerdown` -> `pointermove` -> `pointerup` on `<svelte:window>`, with a 5px activation threshold to distinguish clicks from drags. A floating ghost div follows the cursor. Consumer can override the ghost via `renderDragGhost` snippet.

5. **Tab reorder is integrated into tab drag.** During drag, `_hitTestTabReorder()` checks if the cursor is within the source stack's tab bar bounds (+/-8px vertical tolerance). If so, tabs swap at midpoint boundaries — no drop zones shown. When the cursor leaves the tab bar vertically, it transitions seamlessly to cross-stack drop zone mode. Data attributes `data-jsl-tab-bar` and `data-jsl-tab-idx` enable hit-testing. Queries are scoped to `containerEl` for nested layout isolation.

6. **Drop zones use proportional hit-testing with tab-bar override.** `hitTestDropZone()` queries `[data-stack-id]` elements scoped to the instance's `containerEl` (falls back to `document` when unset). If the cursor is over a target's `[data-jsl-tab-bar]`, it always returns `'center'` (merge into that stack). Otherwise: outer 22% of each edge maps to a directional split, center 56% maps to merge. Visual feedback: blue translucent overlay.

7. **Splitting follows direction rules.** When dropping on an edge:
   - If the parent split matches the new direction, insert adjacent — no extra nesting.
   - If directions differ, wrap the target + new stack in a sub-split. **Save `originalSize` before mutating `target.size`**.
   - If the target is root, wrap root in a new split.

7b. **Multi-step mutations must cleanup between steps.** When a tab drag removes from source AND splits into target, cleanup the source out of the tree BEFORE calling `splitStack`. After cleanup, re-find the target by ID (it may have moved when its parent collapsed). See reference.md **Trap: Stale nodes during multi-step mutations**.

8. **Root-edge docking for full-width/height panels.** `hitTestContainerEdge()` checks if the cursor is within 16px of the layout container edge during drag. When detected, the drop creates a new stack at the root level rather than splitting an individual stack — producing full-width/height docked panels (e.g., a bottom terminal spanning all columns). If the root direction matches, the new stack is appended/prepended; otherwise root is wrapped in a new split.

9. **Resize operates on sibling pairs.** Each resize handle sits between two adjacent children. Dragging adjusts two siblings' flex ratios inversely. Minimum ratio: 0.05 (5% of parent).

10. **Content type is a property of the tab, not the area.** Each tab has a `contentType` string. The `LayoutArea` renders content via the consumer's `renderContent(tab, stack)` snippet. The same stack can host mixed content types.

11. **Maximize is layout swap, not a flag.** `maximize(stackId)` stores the current tree and replaces root with a single stack. `restore()` brings the saved tree back. `isMaximized` getter for UI state. No scattered guards.

12. **Close transfers tabs.** `closeStack(stackId)` empties the stack (cleanup prunes it), then transfers all tabs to the first available remaining stack. `removeStack(stackId)` destroys a stack and all its tabs without redistribution. Safe — if only one stack remains after close, it becomes the sole home for all tabs.

13. **Serialization round-trips cleanly.** `serialize(name?)` produces a `LayoutDocument` (JSON-safe). `deserialize(doc)` regenerates fresh IDs. `load(doc)` replaces the entire tree. Consumer handles persistence (localStorage, file, server).

14. **Theming via CSS custom properties.** `LayoutArea` ships 13 `--jsl-*` variables defined on `.jsl-root` (backgrounds, text, accent, borders). One additional consumer-overridable variable (`--jsl-tab-icon-opacity`, default 0.7) is referenced with a CSS fallback but not defined in the root theme block. Override on `.jsl-root` or any ancestor. All structural classes use `.jsl-*` prefix for targeted overrides.

15. **Consumer snippets for full customization.** Three snippet props on `LayoutArea`:
    - `renderContent(tab, stack)` — **required**, renders area content
    - `renderTabIcon(tab)` — optional, icon in tab bar corner
    - `renderDragGhost(tab, x, y)` — optional, custom drag ghost

16. **Resize handles have separate visual and hit sizes.** `resizeHandleSize` controls the visible line thickness (default 2px). `resizeHitSize` controls the invisible grab area (default 10px). The hit area extends over adjacent content via negative margins — zero layout shift. The visible line is rendered with a `::after` pseudo-element centered within the hit area.

17. **Tab overflow handled automatically.** When tabs don't fit in the tab bar, a "..." overflow button appears. Clicking it opens a fixed-position dropdown listing all tabs. `ResizeObserver` + `MutationObserver` detect overflow; the dropdown closes on drag start or when overflow clears.

18. **Shift+click close for entire areas.** Tab close buttons support Shift+click via the `onshiftclose` callback prop on `LayoutArea`. If set, Shift+clicking a tab's close button calls `onshiftclose(stackId, tabs)` instead of removing the single tab — useful for dirty-state checks before closing an entire area. Falls back to `layout.removeStack()` if not set.

18b. **Tab lifecycle hooks for per-tab resources.** `onTabAdded(tab)` and `onTabRemoved(tab)` fire synchronously inside each mutation method, after `this.root` is updated. Use them to own per-tab resources (explorers, editor instances, subscriptions) — never create resources inside render-time deriveds (`{@const x = getOrCreate(tab)}`), which crashes when the derived re-evaluates with a stale/undefined tab during teardown. Constructor-initial tabs don't fire events; call `layout.init()` after wiring callbacks to bootstrap resources for an initial tree (idempotent), or route the tree through `setLayout()`. Drag-drop preserves tab identity, so moves do not trigger destroy/recreate. For non-default initialization, pre-seed the consumer map before `addTab` — `onTabAdded` fires sync so the handler can tolerate `if (map.has(tab.id)) return`. **Rule: render reads, lifecycle writes.**

19. **Nested/recursive layouts work.** Multiple `LayoutState` instances coexist independently. Each `LayoutArea` binds its root element to `layout.containerEl` on mount. All DOM queries (`hitTestDropZone`, `_hitTestTabReorder`) are scoped to that container, so an inner layout's drag operations never interfere with the outer layout. Use case: a module rendered in a panel can run its own `LayoutState` + `LayoutArea` for sub-panel layout.

20. **Keep it minimal.** The entire library is ~1,600 lines across 5 files, zero dependencies. Resist adding features that aren't needed (floating panels, animations). The tree model naturally supports extensions without code changes.
