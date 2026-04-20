// JSimpleLayout — Reactive layout state manager (Svelte 5)

import type { LayoutNode, StackNode, SplitNode, Tab, DropSide, DropZone, LayoutDocument } from './types.js';
import {
	uid, resetUids, findStack, findSplit, findFirstStack, findStackByContentType,
	cleanup, cloneTree, addTabToStack, removeTabFromStack, reorderTab, splitStack,
	hitTestDropZone, hitTestContainerEdge, serialize, deserialize,
} from './tree.js';

// ---------------------------------------------------------------------------
//  Drag / resize internal state types
// ---------------------------------------------------------------------------

type DragState = {
	tab: Tab;
	sourceStackId: string;
	sourceTabIdx: number;
	startX: number;
	startY: number;
	x: number;
	y: number;
	active: boolean;
};

type ResizeState = {
	parentId: string;
	childIdx: number;
	startPos: number;
	startSizes: number[];
	direction: 'row' | 'column';
	parentSize: number;
};

// ---------------------------------------------------------------------------
//  LayoutState
// ---------------------------------------------------------------------------

export class LayoutState {
	/** The reactive layout tree. All rendering flows from this.
	 *  Uses $state.raw to prevent deep proxy wrapping — the tree is always
	 *  replaced via cloneTree() after mutations. This avoids a Svelte 5 bug
	 *  where snippet parameters share the same proxy: when split() changes
	 *  root from StackNode to SplitNode, old snippets' @const deriveds
	 *  re-evaluate during teardown and crash because node.tabs is undefined
	 *  on the now-SplitNode proxy. With $state.raw, old snippet references
	 *  point to the previous plain object (still a StackNode), not the proxy. */
	root = $state.raw<LayoutNode>({ type: 'stack', id: uid(), tabs: [], activeTab: 0, size: 1 });

	/** Currently active stack ID (receives keyboard focus). */
	activeStackId = $state<string | null>(null);

	/** Tab drag state (internal). */
	dragging = $state<DragState | null>(null);

	/** Current drop zone target (internal). */
	dropZone = $state<DropZone | null>(null);

	/** Resize handle drag state (internal). */
	resizing = $state<ResizeState | null>(null);

	/** DOM container for scoping queries (set by LayoutArea). */
	containerEl: HTMLElement | null = null;

	/** Saved layout for maximize/restore. */
	private _savedLayout: LayoutNode | null = null;

	/** Callback when the active stack changes. */
	onActiveStackChange?: (stackId: string, contentType: string) => void;

	/** Callback when the "add tab" button is clicked in a stack's tab bar. */
	onAddTab = $state<((stackId: string) => void) | undefined>(undefined);

	/** Fired when a tab appears in the tree (new tab, or restored via load/setLayout).
	 *  Drag-drop preserves tab identity — moving a tab between stacks does NOT fire this.
	 *  Not fired for tabs present in the constructor's `initialLayout`; pass the tree through
	 *  `setLayout()` after wiring callbacks if you need lifecycle events for an initial layout. */
	onTabAdded?: (tab: Tab) => void;

	/** Fired when a tab leaves the tree entirely (closed, or its stack destroyed).
	 *  Drag-drop does NOT fire this — tab identity survives the move. */
	onTabRemoved?: (tab: Tab) => void;

	/** Optional guard called before a tab is closed via the UI close button.
	 *  Return false (or a Promise resolving to false) to prevent removal.
	 *  Not called for programmatic removeTab() — only the UI close button. */
	canRemoveTab?: (tab: Tab) => boolean | Promise<boolean>;

	/** Tabs currently live in the tree, keyed by id. Used for diff-based lifecycle events. */
	private _knownTabs = new Map<string, Tab>();

	// -----------------------------------------------------------------------
	//  Initialization
	// -----------------------------------------------------------------------

	constructor(initialLayout?: LayoutNode) {
		if (initialLayout) {
			this.root = initialLayout;
		}
	}

	/** Fire `onTabAdded` for every tab currently in the tree. Call once after wiring
	 *  `onTabAdded` / `onTabRemoved`, to bootstrap per-tab resources for an initial layout
	 *  passed to the constructor. Idempotent: `_knownTabs` absorbs the first pass, so any
	 *  subsequent call is a no-op unless the tree has changed in between.
	 *
	 *  Usage:
	 *    const layout = new LayoutState(restoredTree);
	 *    layout.onTabAdded = createResourceFor;
	 *    layout.onTabRemoved = destroyResourceFor;
	 *    layout.init();   // fires onTabAdded for every tab in restoredTree
	 */
	init(): void {
		this._reconcileTabs();
	}

	// -----------------------------------------------------------------------
	//  Cleanup helper — always clone to force Svelte re-render
	// -----------------------------------------------------------------------

	private _cleanupAndApply(): void {
		const cleaned = cleanup(this.root);
		this.root = cleaned ? cloneTree(cleaned) : this._fallbackLayout();
	}

	private _fallbackLayout(): LayoutNode {
		return { type: 'stack', id: uid(), tabs: [], activeTab: 0, size: 1 };
	}

	// -----------------------------------------------------------------------
	//  Tab lifecycle reconciliation
	//
	//  Every PUBLIC method that mutates tab membership calls _reconcileTabs()
	//  AT ITS END — once, after all intermediate cleanup/clone steps. Firing
	//  on intermediate tree states (e.g. after the source-cleanup step of a
	//  drag) would produce spurious remove+add pairs for tabs that are simply
	//  moving between stacks. ID-diffing treats moves as no-ops by design.
	// -----------------------------------------------------------------------

	private _collectTabs(node: LayoutNode, out: Map<string, Tab>): void {
		if (node.type === 'stack') {
			for (const tab of node.tabs) out.set(tab.id, tab);
		} else {
			for (const child of node.children) this._collectTabs(child, out);
		}
	}

	private _reconcileTabs(): void {
		const current = new Map<string, Tab>();
		this._collectTabs(this.root, current);
		if (this.onTabRemoved) {
			for (const [id, tab] of this._knownTabs) {
				if (!current.has(id)) this.onTabRemoved(tab);
			}
		}
		if (this.onTabAdded) {
			for (const [id, tab] of current) {
				if (!this._knownTabs.has(id)) this.onTabAdded(tab);
			}
		}
		this._knownTabs = current;
	}

	// -----------------------------------------------------------------------
	//  Public API — Tab management
	// -----------------------------------------------------------------------

	/** Add a tab to a specific stack. */
	addTab(stackId: string, tab: Tab, insertIdx?: number): void {
		addTabToStack(this.root, stackId, tab, insertIdx);
		this.root = cloneTree(this.root);
		this._reconcileTabs();
	}

	/** Remove a tab by stack ID and tab index. */
	removeTab(stackId: string, tabIdx: number): void {
		removeTabFromStack(this.root, stackId, tabIdx);
		this._cleanupAndApply();
		this._reconcileTabs();
	}

	/** Add a tab to the first available stack. */
	addTabAnywhere(tab: Tab): void {
		const first = findFirstStack(this.root);
		if (first) {
			addTabToStack(this.root, first.id, tab);
			this.root = cloneTree(this.root);
			this._reconcileTabs();
		}
	}

	/** Create a new tab with a generated ID. */
	static createTab(title: string, contentType: string, props?: Record<string, any>): Tab {
		return { id: uid(), title, contentType, ...(props ? { props } : {}) };
	}

	/** Update a tab's title by tab ID. No-op if the tab isn't found or the title is unchanged. */
	renameTab(tabId: string, newTitle: string): void {
		const tab = this._findTabById(tabId);
		if (!tab || tab.title === newTitle) return;
		tab.title = newTitle;
		this.root = cloneTree(this.root);
	}

	private _findTabById(tabId: string): Tab | null {
		return this._walkTabs(this.root, tabId);
	}

	private _walkTabs(node: LayoutNode, tabId: string): Tab | null {
		if (node.type === 'stack') {
			return (node as StackNode).tabs.find(t => t.id === tabId) ?? null;
		}
		for (const child of (node as SplitNode).children) {
			const found = this._walkTabs(child, tabId);
			if (found) return found;
		}
		return null;
	}

	// -----------------------------------------------------------------------
	//  Public API — Content management
	// -----------------------------------------------------------------------

	/** Find a stack containing the given content type, or null. */
	findContentType(contentType: string): StackNode | null {
		return findStackByContentType(this.root, contentType);
	}

	/** Focus a stack (set it as active, switch to the tab with the given content type). */
	focusContent(contentType: string): boolean {
		const stack = findStackByContentType(this.root, contentType);
		if (!stack) return false;
		const tabIdx = stack.tabs.findIndex(t => t.contentType === contentType);
		if (tabIdx >= 0) stack.activeTab = tabIdx;
		this.activeStackId = stack.id;
		this.root = cloneTree(this.root);
		return true;
	}

	// -----------------------------------------------------------------------
	//  Public API — Close stack
	// -----------------------------------------------------------------------

	/** Close a stack, transferring its tabs to the nearest other stack. */
	closeStack(stackId: string): void {
		const stack = findStack(this.root, stackId);
		if (!stack) return;
		// Collect tabs to redistribute
		const tabs = [...stack.tabs];
		// Remove all tabs (makes the stack empty → cleanup will prune it)
		stack.tabs = [];
		stack.activeTab = 0;
		// Cleanup to remove the empty stack (no reconcile yet — tabs are in-flight).
		this._cleanupAndApply();
		// Transfer tabs to the first available stack
		if (tabs.length > 0) {
			const target = findFirstStack(this.root);
			if (target) {
				for (const tab of tabs) {
					target.tabs.push(tab);
				}
				target.activeTab = target.tabs.length - 1;
				this.root = cloneTree(this.root);
			}
		}
		// Single reconcile after all moves settle — prevents spurious remove/add
		// for tabs that transferred to a surviving stack.
		this._reconcileTabs();
	}

	/** Remove a stack and all its tabs (no redistribution). */
	removeStack(stackId: string): void {
		const stack = findStack(this.root, stackId);
		if (!stack) return;
		stack.tabs = [];
		stack.activeTab = 0;
		this._cleanupAndApply();
		this._reconcileTabs();
	}

	// -----------------------------------------------------------------------
	//  Public API — Splitting
	// -----------------------------------------------------------------------

	/** Split a stack by placing a new tab on one of its edges. */
	split(stackId: string, tab: Tab, side: Exclude<DropSide, 'center'>): void {
		this.root = splitStack(this.root, stackId, tab, side);
		this._cleanupAndApply();
		this._reconcileTabs();
	}

	// -----------------------------------------------------------------------
	//  Public API — Maximize / Restore
	// -----------------------------------------------------------------------

	/** Maximize a stack to fill the entire layout. */
	maximize(stackId: string): void {
		const stack = findStack(this.root, stackId);
		if (!stack) return;
		this._savedLayout = cloneTree(this.root);
		this.root = cloneTree({ ...stack, size: 1 });
	}

	/** Restore the layout from before maximize. */
	restore(): void {
		if (this._savedLayout) {
			this.root = this._savedLayout;
			this._savedLayout = null;
		}
	}

	/** Whether the layout is currently maximized. */
	get isMaximized(): boolean {
		return this._savedLayout !== null;
	}

	// -----------------------------------------------------------------------
	//  Public API — Serialization
	// -----------------------------------------------------------------------

	/** Serialize the current layout to a persistable document. */
	serialize(name?: string): LayoutDocument {
		return serialize(this.root, name);
	}

	/** Load a layout from a serialized document. */
	load(doc: LayoutDocument): void {
		resetUids();
		this.root = deserialize(doc);
		this._savedLayout = null;
		this._reconcileTabs();
	}

	/** Replace the entire layout tree. */
	setLayout(layout: LayoutNode): void {
		this.root = cloneTree(layout);
		this._savedLayout = null;
		this._reconcileTabs();
	}

	// -----------------------------------------------------------------------
	//  Pointer event handlers — wire these to <svelte:window>
	// -----------------------------------------------------------------------

	/** Call from <svelte:window onpointermove>. */
	handlePointerMove(e: PointerEvent): void {
		// Resize
		if (this.resizing) {
			const parent = findSplit(this.root, this.resizing.parentId);
			if (!parent) return;
			const pos = this.resizing.direction === 'row' ? e.clientX : e.clientY;
			const delta = (pos - this.resizing.startPos) / this.resizing.parentSize;
			const i = this.resizing.childIdx;
			const newA = this.resizing.startSizes[i] + delta;
			const newB = this.resizing.startSizes[i + 1] - delta;
			const min = 0.05;
			if (newA >= min && newB >= min) {
				parent.children[i].size = newA;
				parent.children[i + 1].size = newB;
				this.root = cloneTree(this.root);
			}
		}

		// Tab drag
		if (this.dragging) {
			this.dragging.x = e.clientX;
			this.dragging.y = e.clientY;
			const dx = e.clientX - this.dragging.startX;
			const dy = e.clientY - this.dragging.startY;
			if (!this.dragging.active && Math.abs(dx) + Math.abs(dy) > 5) {
				this.dragging.active = true;
			}
			if (this.dragging.active) {
				// Check if cursor is over the source stack's tab bar → reorder mode
				const reorderIdx = this._hitTestTabReorder(e.clientX, e.clientY);
				if (reorderIdx !== null) {
					// Reorder within the same stack
					this.dropZone = null;
					if (reorderIdx !== this.dragging.sourceTabIdx) {
						reorderTab(this.root, this.dragging.sourceStackId, this.dragging.sourceTabIdx, reorderIdx);
						this.dragging.sourceTabIdx = reorderIdx;
						this.root = cloneTree(this.root);
					}
				} else {
					// Check container edges first (root-level docking)
					const edgeSide = hitTestContainerEdge(this.containerEl, e.clientX, e.clientY);
					if (edgeSide) {
						this.dropZone = { stackId: '', side: edgeSide, rootEdge: true };
					} else {
						// Cross-stack drag — normal drop zone hit-testing
						const exclude = this.dragging.sourceStackId;
						this.dropZone = hitTestDropZone(this.root, e.clientX, e.clientY, exclude, this.containerEl);
					}
				}
			}
		}
	}

	/** Call from <svelte:window onpointerup>. */
	handlePointerUp(): void {
		if (this.dragging?.active && this.dropZone) {
			const { tab, sourceStackId, sourceTabIdx } = this.dragging;
			const { stackId: targetStackId, side, rootEdge } = this.dropZone;

			// 1. Remove from source
			removeTabFromStack(this.root, sourceStackId, sourceTabIdx);

			// 2. Cleanup empty source BEFORE splitting
			const afterRemove = cleanup(this.root);
			if (afterRemove) this.root = afterRemove;

			if (rootEdge && side !== 'center') {
				// Root-level edge dock: insert at root boundary for full-width/height
				const direction: 'row' | 'column' = (side === 'left' || side === 'right') ? 'row' : 'column';
				const insertBefore = (side === 'left' || side === 'top');
				const newStack: StackNode = {
					type: 'stack', id: uid(), size: 0.5,
					tabs: [tab], activeTab: 0,
				};

				if (this.root.type === direction) {
					// Same direction as root — insert at edge
					if (insertBefore) {
						(this.root as SplitNode).children.unshift(newStack);
					} else {
						(this.root as SplitNode).children.push(newStack);
					}
					const n = (this.root as SplitNode).children.length;
					for (const c of (this.root as SplitNode).children) c.size = 1 / n;
				} else {
					// Different direction or root is stack — wrap root
					const oldRoot = { ...this.root, size: 0.5 };
					this.root = {
						type: direction, id: uid(), size: 1,
						children: insertBefore ? [newStack, oldRoot] : [oldRoot, newStack],
					} as SplitNode;
				}
			} else {
				// 3. Normal: re-find target and add
				const targetExists = findStack(this.root, targetStackId);
				if (targetExists) {
					if (side === 'center') {
						addTabToStack(this.root, targetStackId, tab);
					} else {
						this.root = splitStack(this.root, targetStackId, tab, side);
					}
				}
			}

			// 4. Final cleanup + clone
			this._cleanupAndApply();
			// 5. Single reconcile — tab identity survived the move, so no events fire
			//    for normal drag-drop. Only fires if drop target was rejected and the
			//    tab effectively disappeared, which shouldn't happen in practice.
			this._reconcileTabs();
		}
		this.dragging = null;
		this.dropZone = null;
		this.resizing = null;
	}

	// -----------------------------------------------------------------------
	//  Internal — called from the renderer components
	// -----------------------------------------------------------------------

	/** Start dragging a tab. Called from tab pointerdown. */
	startTabDrag(e: PointerEvent, tab: Tab, stackId: string, tabIdx: number): void {
		if (tab.pinned) return;
		e.preventDefault();
		this.dragging = {
			tab, sourceStackId: stackId, sourceTabIdx: tabIdx,
			startX: e.clientX, startY: e.clientY,
			x: e.clientX, y: e.clientY,
			active: false,
		};
	}

	/** Start resizing between two siblings. Called from resize handle pointerdown. */
	startResize(e: PointerEvent, parentNode: SplitNode, childIdx: number, parentEl: HTMLElement): void {
		e.preventDefault();
		const rect = parentEl.getBoundingClientRect();
		const parentSize = parentNode.type === 'row' ? rect.width : rect.height;
		this.resizing = {
			parentId: parentNode.id,
			childIdx,
			startPos: parentNode.type === 'row' ? e.clientX : e.clientY,
			startSizes: parentNode.children.map(c => c.size),
			direction: parentNode.type,
			parentSize,
		};
	}

	/** Set active tab on a stack. Called from tab click. */
	activateTab(stackId: string, tabIdx: number): void {
		const stack = findStack(this.root, stackId);
		if (stack) {
			stack.activeTab = tabIdx;
			this.root = cloneTree(this.root);
			this.activeStackId = stackId;
			const tab = stack.tabs[tabIdx];
			if (tab && this.onActiveStackChange) {
				this.onActiveStackChange(stackId, tab.contentType);
			}
		}
	}

	/**
	 * Hit-test the source stack's tab bar for reorder.
	 * Returns the target tab index if the cursor is over a different tab
	 * in the same stack's tab bar, or null if outside.
	 */
	private _hitTestTabReorder(x: number, y: number): number | null {
		if (!this.dragging) return null;
		const stackEl = (this.containerEl ?? document).querySelector<HTMLElement>(
			`[data-stack-id="${this.dragging.sourceStackId}"]`
		);
		if (!stackEl) return null;

		const tabBar = stackEl.querySelector<HTMLElement>('[data-jsl-tab-bar]');
		if (!tabBar) return null;

		const barRect = tabBar.getBoundingClientRect();
		// Cursor must be within the tab bar's vertical bounds (with some tolerance)
		if (y < barRect.top - 8 || y > barRect.bottom + 8) return null;
		if (x < barRect.left || x > barRect.right) return null;

		// Find which tab the cursor is over by querying tab elements
		const tabs = tabBar.querySelectorAll<HTMLElement>('[data-jsl-tab-idx]');
		for (const tabEl of tabs) {
			const rect = tabEl.getBoundingClientRect();
			const midX = rect.left + rect.width / 2;
			const idx = parseInt(tabEl.dataset.jslTabIdx!, 10);
			// If cursor is left of this tab's midpoint, insert before it
			if (x < midX) return idx;
		}
		// Past all tabs — return last index
		const stack = findStack(this.root, this.dragging.sourceStackId);
		return stack ? stack.tabs.length - 1 : null;
	}
}

export { uid, resetUids } from './tree.js';
