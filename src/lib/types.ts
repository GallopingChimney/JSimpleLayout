// JSimpleLayout — Type definitions

/** A single tab within a stack panel. */
export type Tab = {
	id: string;
	title: string;
	/** Arbitrary string identifying what content this tab displays. */
	contentType: string;
	/** Optional data passed to the content renderer. */
	props?: Record<string, any>;
};

/** Leaf node — a tabbed panel group. One tab is active at a time. */
export type StackNode = {
	type: 'stack';
	id: string;
	tabs: Tab[];
	activeTab: number;
	/** Flex ratio relative to siblings (0–1). */
	size: number;
};

/** Branch node — children laid out horizontally (row) or vertically (column). */
export type SplitNode = {
	type: 'row' | 'column';
	id: string;
	children: LayoutNode[];
	/** Flex ratio relative to siblings (0–1). */
	size: number;
};

/** A node in the layout tree — either a split or a stack. */
export type LayoutNode = StackNode | SplitNode;

/** Drop zone side — edges create splits, center adds to the stack. */
export type DropSide = 'top' | 'bottom' | 'left' | 'right' | 'center';

/** Drop zone target. */
export type DropZone = {
	stackId: string;
	side: DropSide;
	/** When true, the drop targets the root level for full-width/height docking. */
	rootEdge?: boolean;
};

/** Serialized layout document (for persistence). */
export interface LayoutDocument {
	version: 1;
	name?: string;
	tree: SerializedNode;
}

export interface SerializedNode {
	type: 'row' | 'column' | 'stack';
	size: number;
	children?: SerializedNode[];
	tabs?: SerializedTab[];
	activeTab?: number;
}

export interface SerializedTab {
	title: string;
	contentType: string;
	props?: Record<string, any>;
}
