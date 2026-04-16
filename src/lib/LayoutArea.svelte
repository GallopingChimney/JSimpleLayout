<script lang="ts">
	import { onMount } from 'svelte';
	import type { LayoutNode, StackNode, SplitNode, Tab, DropZone } from './types.js';
	import { LayoutState } from './LayoutState.svelte.js';

	let rootEl: HTMLElement;

	let {
		layout,
		renderContent,
		renderTabIcon,
		renderDragGhost,
		class: className = '',
		tabBarHeight = 32,
		resizeHandleSize = 4,
		resizeHitSize,
	}: {
		/** The reactive layout state instance. */
		layout: LayoutState;
		/** Render the content area for a tab. Receives the active tab and the stack node. */
		renderContent: (tab: Tab, stack: StackNode) => any;
		/** Optional: render a custom icon in the tab bar corner. Receives the active tab. */
		renderTabIcon?: (tab: Tab) => any;
		/** Optional: render a custom drag ghost. Receives the dragged tab and cursor position. */
		renderDragGhost?: (tab: Tab, x: number, y: number) => any;
		/** Additional CSS classes on the root container. */
		class?: string;
		/** Tab bar height in pixels (default 32). */
		tabBarHeight?: number;
		/** Resize handle visible thickness in pixels (default 4). */
		resizeHandleSize?: number;
		/** Resize handle grab area in pixels (default matches resizeHandleSize). */
		resizeHitSize?: number;
	} = $props();

	onMount(() => {
		layout.containerEl = rootEl;
		return () => { layout.containerEl = null; };
	});
</script>

<svelte:window
	onpointermove={(e) => layout.handlePointerMove(e)}
	onpointerup={() => layout.handlePointerUp()}
/>

<!-- Drag ghost -->
{#if layout.dragging?.active}
	{#if renderDragGhost}
		{@render renderDragGhost(layout.dragging.tab, layout.dragging.x, layout.dragging.y)}
	{:else}
		<div
			class="jsl-drag-ghost"
			style="left:{layout.dragging.x + 12}px; top:{layout.dragging.y - 10}px;"
		>
			{layout.dragging.tab.title}
		</div>
	{/if}
{/if}

<!-- Layout root -->
<div class="jsl-root {className}" bind:this={rootEl}>
	{@render layoutNode(layout.root)}
</div>

<!-- ==================== Recursive renderer ==================== -->

{#snippet layoutNode(node: LayoutNode)}
	{#if node.type === 'stack'}
		{@render stackPanel(node)}
	{:else}
		{@render splitPanel(node as SplitNode)}
	{/if}
{/snippet}

{#snippet splitPanel(node: SplitNode)}
	<div
		class="jsl-split"
		class:jsl-row={node.type === 'row'}
		class:jsl-col={node.type === 'column'}
		data-split-id={node.id}
	>
		{#each node.children as child, i (child.id)}
			<div
				class="jsl-child"
				style="flex: {child.size} 1 0%;"
			>
				{@render layoutNode(child)}
			</div>

			{#if i < node.children.length - 1}
				<div
					class="jsl-resize-handle"
					class:jsl-resize-h={node.type === 'row'}
					class:jsl-resize-v={node.type === 'column'}
					style="--jsl-hit:{resizeHitSize ?? resizeHandleSize + 4}px; --jsl-vis:{resizeHandleSize}px;"
					onpointerdown={(e) => {
						const parentEl = e.currentTarget.parentElement;
						if (parentEl) layout.startResize(e, node, i, parentEl);
					}}
				></div>
			{/if}
		{/each}
	</div>
{/snippet}

{#snippet stackPanel(node: StackNode)}
	{@const activeTab = node.tabs[node.activeTab]}
	{@const isDropTarget = layout.dropZone?.stackId === node.id}
	{@const isDragSource = layout.dragging?.sourceStackId === node.id}
	<div
		class="jsl-stack"
		data-stack-id={node.id}
		onpointerdown={() => layout.activateTab(node.id, node.activeTab)}
	>
		<!-- Tab bar -->
		<div class="jsl-tab-bar" style="height:{tabBarHeight}px;" data-jsl-tab-bar>
			<!-- Area type icon -->
			{#if activeTab}
				<div class="jsl-tab-icon">
					{#if renderTabIcon}
						{@render renderTabIcon(activeTab)}
					{/if}
				</div>
			{/if}

			<!-- Tabs -->
			{#each node.tabs as tab, i (tab.id)}
				{@const isActive = i === node.activeTab}
				{@const isBeingDragged = isDragSource && layout.dragging?.active && layout.dragging.sourceTabIdx === i}
				<div
					class="jsl-tab"
					class:jsl-tab-active={isActive}
					class:jsl-tab-dragging={isBeingDragged}
					role="tab"
					tabindex="0"
					data-jsl-tab-idx={i}
					onpointerdown={(e) => {
						layout.activateTab(node.id, i);
						layout.startTabDrag(e, tab, node.id, i);
					}}
				>
					<span class="jsl-tab-label">{tab.title}</span>
					<button
						class="jsl-tab-close"
						onpointerdown={(e) => e.stopPropagation()}
						onclick={(e) => { e.stopPropagation(); layout.removeTab(node.id, i); }}
					>
						&times;
					</button>
				</div>
			{/each}

			<!-- Spacer + area controls -->
			<div class="jsl-tab-spacer"></div>
			<div class="jsl-area-controls">
				{#if layout.isMaximized}
					<button
						class="jsl-area-btn"
						title="Restore"
						onclick={() => layout.restore()}
					>
						&#9724;
					</button>
				{:else}
					<button
						class="jsl-area-btn"
						title="Maximize"
						onclick={() => layout.maximize(node.id)}
					>
						&#9723;
					</button>
				{/if}
				<button
					class="jsl-area-btn"
					title="Close area"
					onclick={() => layout.closeStack(node.id)}
				>
					&times;
				</button>
			</div>
		</div>

		<!-- Content area -->
		<div class="jsl-content">
			{#if activeTab}
				{@render renderContent(activeTab, node)}
			{/if}
		</div>

		<!-- Drop zone overlay -->
		{#if isDropTarget && layout.dragging?.active}
			{@const side = layout.dropZone!.side}
			<div class="jsl-drop-overlay">
				<div
					class="jsl-drop-zone"
					class:jsl-drop-center={side === 'center'}
					class:jsl-drop-left={side === 'left'}
					class:jsl-drop-right={side === 'right'}
					class:jsl-drop-top={side === 'top'}
					class:jsl-drop-bottom={side === 'bottom'}
				></div>
			</div>
		{/if}
	</div>
{/snippet}

<style>
	/* ================================================================
	   JSimpleLayout — Base styles
	   Override with CSS custom properties or target .jsl-* classes.
	   ================================================================ */

	/* --- Custom properties (theme) --- */
	.jsl-root {
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
	}

	/* --- Root --- */
	.jsl-root {
		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100%;
		overflow: hidden;
		background: var(--jsl-bg);
		color: var(--jsl-text);
		user-select: none;
	}

	/* --- Split containers --- */
	.jsl-split {
		display: flex;
		min-width: 0;
		min-height: 0;
		width: 100%;
		height: 100%;
		overflow: hidden;
	}
	.jsl-row { flex-direction: row; }
	.jsl-col { flex-direction: column; }

	.jsl-child {
		min-width: 0;
		min-height: 0;
		overflow: hidden;
	}

	/* --- Resize handles --- */
	.jsl-resize-handle {
		flex-shrink: 0;
		z-index: 10;
		position: relative;
		background: transparent;
	}
	.jsl-resize-handle::after {
		content: '';
		position: absolute;
		background: var(--jsl-handle-bg);
		transition: background 0.15s;
	}
	.jsl-resize-handle:hover::after,
	.jsl-resize-handle:active::after {
		background: var(--jsl-handle-hover);
	}
	.jsl-resize-h {
		width: var(--jsl-hit);
		margin-inline: calc((var(--jsl-vis) - var(--jsl-hit)) / 2);
		cursor: col-resize;
	}
	.jsl-resize-h::after {
		top: 0;
		bottom: 0;
		left: 50%;
		width: var(--jsl-vis);
		transform: translateX(-50%);
	}
	.jsl-resize-v {
		height: var(--jsl-hit);
		margin-block: calc((var(--jsl-vis) - var(--jsl-hit)) / 2);
		cursor: row-resize;
	}
	.jsl-resize-v::after {
		left: 0;
		right: 0;
		top: 50%;
		height: var(--jsl-vis);
		transform: translateY(-50%);
	}

	/* --- Stack (tabbed panel) --- */
	.jsl-stack {
		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100%;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
		position: relative;
	}

	/* --- Tab bar --- */
	.jsl-tab-bar {
		display: flex;
		align-items: center;
		flex-shrink: 0;
		overflow-x: auto;
		background: var(--jsl-surface);
		border-bottom: 1px solid var(--jsl-border);
	}

	.jsl-tab-icon {
		width: 24px;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		color: var(--jsl-text-dim);
		border-right: 1px solid var(--jsl-border);
	}

	/* --- Individual tab --- */
	.jsl-tab {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 0 8px;
		height: 100%;
		font-size: 12px;
		cursor: grab;
		white-space: nowrap;
		border-right: 1px solid rgba(64, 64, 64, 0.3);
		color: var(--jsl-text-muted);
	}
	.jsl-tab:hover {
		color: var(--jsl-text);
		background: var(--jsl-tab-hover-bg);
	}
	.jsl-tab-active {
		background: var(--jsl-tab-active-bg);
		color: var(--jsl-text);
	}

	.jsl-tab-dragging {
		opacity: 0.4;
	}

	.jsl-tab-label {
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 120px;
	}

	.jsl-tab-close {
		margin-left: 2px;
		border-radius: 3px;
		padding: 0 3px;
		font-size: 14px;
		line-height: 1;
		opacity: 0;
		color: var(--jsl-text-muted);
		background: none;
		border: none;
		cursor: pointer;
	}
	.jsl-tab-close:hover {
		background: rgba(255, 255, 255, 0.1);
		opacity: 1;
	}
	.jsl-tab:hover .jsl-tab-close,
	.jsl-tab-active .jsl-tab-close {
		opacity: 0.6;
	}

	/* --- Tab bar spacer + area controls --- */
	.jsl-tab-spacer {
		flex: 1;
		min-width: 8px;
	}

	.jsl-area-controls {
		display: flex;
		align-items: center;
		flex-shrink: 0;
		padding: 0 4px;
		gap: 2px;
	}

	.jsl-area-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border: none;
		border-radius: 3px;
		background: none;
		color: var(--jsl-text-dim);
		font-size: 14px;
		line-height: 1;
		cursor: pointer;
		opacity: 0;
		transition: opacity 0.15s, background 0.15s;
	}
	.jsl-area-btn:hover {
		background: rgba(255, 255, 255, 0.1);
		color: var(--jsl-text);
	}
	.jsl-stack:hover .jsl-area-btn {
		opacity: 0.6;
	}
	.jsl-stack:hover .jsl-area-btn:hover {
		opacity: 1;
	}

	/* --- Content area --- */
	.jsl-content {
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}

	/* --- Drop zone overlay --- */
	.jsl-drop-overlay {
		position: absolute;
		inset: 0;
		pointer-events: none;
		z-index: 20;
	}

	.jsl-drop-zone {
		position: absolute;
		background: var(--jsl-accent-bg);
		border: 2px solid var(--jsl-accent-border);
		border-radius: 4px;
		transition: all 0.1s;
	}
	.jsl-drop-center { inset: 0; }
	.jsl-drop-left   { top: 0; bottom: 0; left: 0; right: 55%; }
	.jsl-drop-right  { top: 0; bottom: 0; left: 55%; right: 0; }
	.jsl-drop-top    { top: 0; bottom: 55%; left: 0; right: 0; }
	.jsl-drop-bottom { top: 55%; bottom: 0; left: 0; right: 0; }

	/* --- Drag ghost --- */
	:global(.jsl-drag-ghost) {
		position: fixed;
		pointer-events: none;
		z-index: 50;
		padding: 4px 12px;
		border-radius: 4px;
		font-size: 12px;
		font-weight: 500;
		background: var(--jsl-surface, #171717);
		color: var(--jsl-text, #e5e5e5);
		border: 1px solid rgba(255, 255, 255, 0.2);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
	}
</style>
