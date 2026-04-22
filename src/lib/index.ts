// JSimpleLayout — Public API

// Types
export type {
	Tab,
	TabTopEdge,
	TabTopEdgeVisibility,
	StackNode,
	SplitNode,
	LayoutNode,
	DropSide,
	DropZone,
	LayoutDocument,
	SerializedNode,
	SerializedTab,
} from './types.js';

// Components
export { default as LayoutArea } from './LayoutArea.svelte';

// State manager
export { LayoutState, uid, resetUids } from './LayoutState.svelte.js';

// Pure tree utilities (for advanced use / testing)
export {
	findParent,
	findStack,
	findSplit,
	findFirstStack,
	findStackByContentType,
	cleanup,
	cloneTree,
	addTabToStack,
	removeTabFromStack,
	reorderTab,
	splitStack,
	hitTestDropZone,
	hitTestContainerEdge,
	serialize,
	deserialize,
} from './tree.js';
