// JSimpleLayout — Reactive layout state manager (Svelte 5)

import type { LayoutNode, StackNode, SplitNode, Tab, DropSide, DropZone, LayoutDocument } from './types.js';
import {
	uid, resetUids, findStack, findSplit, findFirstStack, findStackByContentType,
	cleanup, cloneTree, addTabToStack, removeTabFromStack, reorderTab, splitStack,
	hitTestDropZone, serialize, deserialize,
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
	/** The reactive layout tree. All rendering flows from this. */
	root = $state<LayoutNode>({ type: 'stack', id: uid(), tabs: [], activeTab: 0, size: 1 });

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

	// -----------------------------------------------------------------------
	//  Initialization
	// -----------------------------------------------------------------------

	constructor(initialLayout?: LayoutNode) {
		if (initialLayout) {
			this.root = initialLayout;
		}
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
	//  Public API — Tab management
	// -----------------------------------------------------------------------

	/** Add a tab to a specific stack. */
	addTab(stackId: string, tab: Tab, insertIdx?: number): void {
		addTabToStack(this.root, stackId, tab, insertIdx);
		this.root = cloneTree(this.root);
	}

	/** Remove a tab by stack ID and tab index. */
	removeTab(stackId: string, tabIdx: number): void {
		removeTabFromStack(this.root, stackId, tabIdx);
		this._cleanupAndApply();
	}

	/** Add a tab to the first available stack. */
	addTabAnywhere(tab: Tab): void {
		const first = findFirstStack(this.root);
		if (first) {
			addTabToStack(this.root, first.id, tab);
			this.root = cloneTree(this.root);
		}
	}

	/** Create a new tab with a generated ID. */
	static createTab(title: string, contentType: string, props?: Record<string, any>): Tab {
		return { id: uid(), title, contentType, ...(props ? { props } : {}) };
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
		// Cleanup to remove the empty stack
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
	}

	// -----------------------------------------------------------------------
	//  Public API — Splitting
	// -----------------------------------------------------------------------

	/** Split a stack by placing a new tab on one of its edges. */
	split(stackId: string, tab: Tab, side: Exclude<DropSide, 'center'>): void {
		this.root = splitStack(this.root, stackId, tab, side);
		this._cleanupAndApply();
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
	}

	/** Replace the entire layout tree. */
	setLayout(layout: LayoutNode): void {
		this.root = cloneTree(layout);
		this._savedLayout = null;
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
					}
				} else {
					// Cross-stack drag — normal drop zone hit-testing
					const exclude = this.dragging.sourceStackId;
					this.dropZone = hitTestDropZone(this.root, e.clientX, e.clientY, exclude, this.containerEl);
				}
			}
		}
	}

	/** Call from <svelte:window onpointerup>. */
	handlePointerUp(): void {
		if (this.dragging?.active && this.dropZone) {
			const { tab, sourceStackId, sourceTabIdx } = this.dragging;
			const { stackId: targetStackId, side } = this.dropZone;

			// 1. Remove from source
			removeTabFromStack(this.root, sourceStackId, sourceTabIdx);

			// 2. Cleanup empty source BEFORE splitting
			const afterRemove = cleanup(this.root);
			if (afterRemove) this.root = afterRemove;

			// 3. Re-find target and add
			const targetExists = findStack(this.root, targetStackId);
			if (targetExists) {
				if (side === 'center') {
					addTabToStack(this.root, targetStackId, tab);
				} else {
					this.root = splitStack(this.root, targetStackId, tab, side);
				}
			}

			// 4. Final cleanup + clone
			this._cleanupAndApply();
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
