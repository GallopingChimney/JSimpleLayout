// JSimpleLayout — Pure tree algorithms (no Svelte dependency)

import type { LayoutNode, StackNode, SplitNode, Tab, DropSide, LayoutDocument, SerializedNode, SerializedTab } from './types.js';

// ---------------------------------------------------------------------------
//  ID generation
// ---------------------------------------------------------------------------

let _nextId = 0;

/** Generate a unique node/tab ID. */
export function uid(): string { return `jsl_${_nextId++}`; }

/** Reset the ID counter (useful for tests and fresh layouts). */
export function resetUids(): void { _nextId = 0; }

// ---------------------------------------------------------------------------
//  Tree traversal
// ---------------------------------------------------------------------------

/** Find parent of a node by id. Returns [parent, childIndex] or null. */
export function findParent(
	node: LayoutNode,
	targetId: string,
	parent: SplitNode | null = null,
	idx = 0,
): [SplitNode, number] | null {
	if (node.id === targetId) return parent ? [parent, idx] : null;
	if (node.type !== 'stack') {
		for (let i = 0; i < node.children.length; i++) {
			const found = findParent(node.children[i], targetId, node, i);
			if (found) return found;
		}
	}
	return null;
}

/** Find a stack node by id (DFS). */
export function findStack(node: LayoutNode, id: string): StackNode | null {
	if (node.id === id && node.type === 'stack') return node;
	if (node.type !== 'stack') {
		for (const child of node.children) {
			const found = findStack(child, id);
			if (found) return found;
		}
	}
	return null;
}

/** Find a split node by id (DFS). */
export function findSplit(node: LayoutNode, id: string): SplitNode | null {
	if (node.id === id && node.type !== 'stack') return node as SplitNode;
	if (node.type !== 'stack') {
		for (const child of node.children) {
			const found = findSplit(child, id);
			if (found) return found;
		}
	}
	return null;
}

/** Find the first stack (depth-first). */
export function findFirstStack(node: LayoutNode): StackNode | null {
	if (node.type === 'stack') return node;
	for (const child of (node as SplitNode).children) {
		const found = findFirstStack(child);
		if (found) return found;
	}
	return null;
}

/** Find a stack that contains a tab with the given content type. */
export function findStackByContentType(
	node: LayoutNode,
	contentType: string,
): StackNode | null {
	if (node.type === 'stack') {
		return node.tabs.some(t => t.contentType === contentType) ? node : null;
	}
	for (const child of (node as SplitNode).children) {
		const found = findStackByContentType(child, contentType);
		if (found) return found;
	}
	return null;
}

// ---------------------------------------------------------------------------
//  Tree cleanup
// ---------------------------------------------------------------------------

/**
 * Remove empty stacks, collapse single-child splits, normalize sizes.
 * Returns null if the entire tree is empty.
 */
export function cleanup(node: LayoutNode): LayoutNode | null {
	if (node.type === 'stack') {
		return node.tabs.length > 0 ? node : null;
	}
	const cleaned = node.children.map(c => cleanup(c)).filter(Boolean) as LayoutNode[];
	if (cleaned.length === 0) return null;
	if (cleaned.length === 1) {
		cleaned[0].size = node.size;
		return cleaned[0];
	}
	// Normalize sizes to sum to 1
	const total = cleaned.reduce((s, c) => s + c.size, 0);
	if (total > 0 && Math.abs(total - 1) > 0.001) {
		for (const c of cleaned) c.size = c.size / total;
	}
	node.children = cleaned;
	return node;
}

/**
 * Deep-clone a layout tree. Creates entirely new objects — critical for
 * forcing Svelte 5 reactivity after structural mutations.
 */
export function cloneTree(node: LayoutNode): LayoutNode {
	if (node.type === 'stack') {
		return { ...node, tabs: node.tabs.map(t => ({ ...t })) };
	}
	return { ...node, children: (node as SplitNode).children.map(c => cloneTree(c)) };
}

// ---------------------------------------------------------------------------
//  Tree mutations
// ---------------------------------------------------------------------------

/** Add a tab to a stack. Returns true if successful. */
export function addTabToStack(
	root: LayoutNode,
	stackId: string,
	tab: Tab,
	insertIdx?: number,
): boolean {
	const stack = findStack(root, stackId);
	if (!stack) return false;
	const idx = insertIdx ?? stack.tabs.length;
	stack.tabs.splice(idx, 0, tab);
	stack.activeTab = idx;
	return true;
}

/** Reorder a tab within a stack. Returns true if the swap happened.
 *  Refuses to move a pinned tab or to displace a pinned tab from its position. */
export function reorderTab(
	root: LayoutNode,
	stackId: string,
	fromIdx: number,
	toIdx: number,
): boolean {
	const stack = findStack(root, stackId);
	if (!stack || fromIdx === toIdx) return false;
	if (fromIdx < 0 || fromIdx >= stack.tabs.length) return false;
	if (toIdx < 0 || toIdx >= stack.tabs.length) return false;
	if (stack.tabs[fromIdx].pinned || stack.tabs[toIdx].pinned) return false;
	const [tab] = stack.tabs.splice(fromIdx, 1);
	stack.tabs.splice(toIdx, 0, tab);
	stack.activeTab = toIdx;
	return true;
}

/** Remove a tab from a stack. Does NOT cleanup — caller must cleanup after. */
export function removeTabFromStack(
	root: LayoutNode,
	stackId: string,
	tabIdx: number,
): Tab | null {
	const stack = findStack(root, stackId);
	if (!stack || tabIdx < 0 || tabIdx >= stack.tabs.length) return null;
	const [removed] = stack.tabs.splice(tabIdx, 1);
	if (stack.activeTab >= stack.tabs.length) {
		stack.activeTab = Math.max(0, stack.tabs.length - 1);
	}
	return removed;
}

/**
 * Split a stack by inserting a new stack on a given side.
 * Handles same-direction insert, cross-direction wrap, and root wrap.
 *
 * IMPORTANT: Save originalSize before mutating target — see reference docs
 * "Trap: Premature size mutation in splitStack".
 */
export function splitStack(
	root: LayoutNode,
	stackId: string,
	tab: Tab,
	side: Exclude<DropSide, 'center'>,
): LayoutNode {
	const direction: 'row' | 'column' = (side === 'left' || side === 'right') ? 'row' : 'column';
	const insertBefore = (side === 'left' || side === 'top');

	const newStack: StackNode = {
		type: 'stack', id: uid(), size: 0.5,
		tabs: [tab], activeTab: 0,
	};

	const parentInfo = findParent(root, stackId);

	if (!parentInfo) {
		// Target is root — wrap in a new split
		const oldRoot = { ...root, size: 0.5 };
		return {
			type: direction, id: uid(), size: 1,
			children: insertBefore ? [newStack, oldRoot] : [oldRoot, newStack],
		};
	}

	const [parent, idx] = parentInfo;
	const target = parent.children[idx];
	const originalSize = target.size; // save BEFORE mutating

	if (parent.type === direction) {
		// Same direction — insert adjacent, rebalance
		parent.children.splice(insertBefore ? idx : idx + 1, 0, newStack);
		const n = parent.children.length;
		for (const c of parent.children) c.size = 1 / n;
	} else {
		// Different direction — wrap target + new in a sub-split
		const wrapper: SplitNode = {
			type: direction, id: uid(), size: originalSize,
			children: insertBefore ? [newStack, target] : [target, newStack],
		};
		target.size = 0.5;
		parent.children[idx] = wrapper;
	}

	return root;
}

// ---------------------------------------------------------------------------
//  Serialization
// ---------------------------------------------------------------------------

/** Serialize a layout tree to a persistable document. */
export function serialize(root: LayoutNode, name?: string): LayoutDocument {
	function serializeNode(node: LayoutNode): SerializedNode {
		if (node.type === 'stack') {
			return {
				type: 'stack',
				size: node.size,
				tabs: node.tabs.map((t): SerializedTab => ({
					title: t.title,
					contentType: t.contentType,
					...(t.props ? { props: t.props } : {}),
					...(t.pinned ? { pinned: true } : {}),
				})),
				activeTab: node.activeTab,
			};
		}
		return {
			type: node.type,
			size: node.size,
			children: node.children.map(c => serializeNode(c)),
		};
	}
	return { version: 1, name, tree: serializeNode(root) };
}

/** Deserialize a layout document into a live tree (generates fresh IDs). */
export function deserialize(doc: LayoutDocument): LayoutNode {
	function loadNode(s: SerializedNode): LayoutNode {
		if (s.type === 'stack') {
			return {
				type: 'stack',
				id: uid(),
				size: s.size,
				tabs: (s.tabs ?? []).map((t): Tab => ({
					id: uid(),
					title: t.title,
					contentType: t.contentType,
					...(t.props ? { props: t.props } : {}),
					...(t.pinned ? { pinned: true } : {}),
				})),
				activeTab: s.activeTab ?? 0,
			};
		}
		return {
			type: s.type,
			id: uid(),
			size: s.size,
			children: (s.children ?? []).map(c => loadNode(c)),
		};
	}
	return loadNode(doc.tree);
}

// ---------------------------------------------------------------------------
//  Hit-testing
// ---------------------------------------------------------------------------

/**
 * Hit-test all stack elements to find the drop zone at (x, y).
 * Queries the DOM for `[data-stack-id]` elements.
 *
 * @param x - clientX
 * @param y - clientY
 * @param excludeStackId - skip this stack (e.g. source of a single-tab drag)
 * @param edgeThreshold - proportion of edge zone (default 0.22 = 22%)
 */
export function hitTestDropZone(
	root: LayoutNode,
	x: number,
	y: number,
	excludeStackId?: string,
	container?: ParentNode | null,
	edgeThreshold = 0.22,
): { stackId: string; side: DropSide } | null {
	const els = (container ?? document).querySelectorAll<HTMLElement>('[data-stack-id]');
	for (const el of els) {
		const rect = el.getBoundingClientRect();
		if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;

		const stackId = el.dataset.stackId!;
		if (stackId === excludeStackId) {
			const stack = findStack(root, stackId);
			if (stack && stack.tabs.length <= 1) continue;
		}

		const relX = (x - rect.left) / rect.width;
		const relY = (y - rect.top) / rect.height;

		// Cursor over target's tab bar → always merge (center)
		const targetTabBar = el.querySelector<HTMLElement>('[data-jsl-tab-bar]');
		const inTabBar = targetTabBar && y <= targetTabBar.getBoundingClientRect().bottom;

		let side: DropSide;
		if (inTabBar) side = 'center';
		else if (relX < edgeThreshold) side = 'left';
		else if (relX > 1 - edgeThreshold) side = 'right';
		else if (relY < edgeThreshold) side = 'top';
		else if (relY > 1 - edgeThreshold) side = 'bottom';
		else side = 'center';

		return { stackId, side };
	}
	return null;
}

/**
 * Hit-test the layout container edges for root-level docking.
 * Returns a directional side if the cursor is within `threshold` pixels
 * of the container edge, or null if not near any edge.
 */
export function hitTestContainerEdge(
	container: HTMLElement | null,
	x: number,
	y: number,
	threshold = 16,
): Exclude<DropSide, 'center'> | null {
	if (!container) return null;
	const rect = container.getBoundingClientRect();
	if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return null;

	if (x - rect.left < threshold) return 'left';
	if (rect.right - x < threshold) return 'right';
	if (y - rect.top < threshold) return 'top';
	if (rect.bottom - y < threshold) return 'bottom';

	return null;
}
