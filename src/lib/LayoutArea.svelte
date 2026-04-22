<script lang="ts">
	import { onMount, tick } from 'svelte';
	import type { LayoutNode, StackNode, SplitNode, Tab, DropZone } from './types.js';
	import { LayoutState } from './LayoutState.svelte.js';
	import { findStack, cloneTree } from './tree.js';

	let rootEl: HTMLElement;

	let {
		layout,
		renderContent,
		renderTabIcon,
		renderDragGhost,
		class: className = '',
		style: styleAttr = '',
		tabBarHeight = 26,
		resizeHandleSize = 2,
		resizeHitSize = 10,
		showPinButtons = false,
		pinOnHover = true,
		onshiftclose,
		onareaclose,
	}: {
		/** The reactive layout state instance. */
		layout: LayoutState;
		/** Render the content area for a tab. Receives the active tab and the stack node. */
		renderContent: (tab: Tab, stack: StackNode) => any;
		/** Optional: render an icon inside each tab. Receives the tab. */
		renderTabIcon?: (tab: Tab) => any;
		/** Optional: render a custom drag ghost. Receives the dragged tab and cursor position. */
		renderDragGhost?: (tab: Tab, x: number, y: number) => any;
		/** Additional CSS classes on the root container. */
		class?: string;
		/** Inline style on the root container (use for CSS custom property overrides). */
		style?: string;
		/** Tab bar height in pixels (default 32). */
		tabBarHeight?: number;
		/** Resize handle visible thickness in pixels (default 4). */
		resizeHandleSize?: number;
		/** Resize handle grab area in pixels (default matches resizeHandleSize). */
		resizeHitSize?: number;
		/** Show pin/unpin buttons on tabs (default false). */
		showPinButtons?: boolean;
		/** When true, unpinned pin buttons are hidden until tab hover (default true). */
		pinOnHover?: boolean;
		/** Callback when Shift+click on a tab close button (close entire area). Receives stack ID and its tabs. If not set, falls back to layout.removeStack(). */
		onshiftclose?: (stackId: string, tabs: Tab[]) => void;
		/** Callback when the area close button (×) is clicked (without Shift). Receives stack ID and its tabs. If not set, falls back to layout.removeStack(). Shift+click always transfers tabs via layout.closeStack() with preserveActiveTab. */
		onareaclose?: (stackId: string, tabs: Tab[]) => void;
	} = $props();

	function togglePin(tab: Tab) {
		tab.pinned = !tab.pinned;
		layout.root = cloneTree(layout.root);
	}

	function tabTopEdgeStyle(tab: Tab, isActive: boolean): string {
		if (!tab.topEdge || tab.topEdge.thickness <= 0 || !tab.topEdge.color) return '';
		const inactiveVisibility = tab.topEdge.inactiveVisibility ?? 'muted';
		const inactiveOpacity = inactiveVisibility === 'transparent'
			? 0
			: inactiveVisibility === 'muted'
				? 0.4
				: 1;
		return [
			`--jsl-tab-top-edge-color:${tab.topEdge.color}`,
			`--jsl-tab-top-edge-thickness:${tab.topEdge.thickness}px`,
			`--jsl-tab-top-edge-opacity:${isActive ? 1 : inactiveOpacity}`,
		].join(';');
	}

	onMount(() => {
		layout.containerEl = rootEl;
		return () => { layout.containerEl = null; };
	});

	// -----------------------------------------------------------------------
	//  Tab overflow detection + "more" dropdown
	// -----------------------------------------------------------------------

	let overflowStacks = $state<Record<string, boolean>>({});
	let openOverflowId = $state<string | null>(null);
	let overflowPos = $state<{ top: number; right: number } | null>(null);

	// Per-stack tab bar collapsed state (ephemeral UI, not persisted in tree)
	let collapsedStacks = $state<Record<string, boolean>>({});

	// Close overflow dropdown when drag starts
	$effect(() => {
		if (layout.dragging?.active) {
			openOverflowId = null;
			overflowPos = null;
		}
	});

	// Close overflow dropdown if overflow clears (e.g. tab removed)
	$effect(() => {
		if (openOverflowId && !overflowStacks[openOverflowId]) {
			openOverflowId = null;
			overflowPos = null;
		}
	});

	function observeOverflow(el: HTMLElement, stackId: string) {
		function check() {
			overflowStacks[stackId] = el.scrollWidth > el.clientWidth + 1;
		}
		const ro = new ResizeObserver(check);
		ro.observe(el);
		const mo = new MutationObserver(check);
		mo.observe(el, { childList: true, subtree: true });
		check();
		return {
			destroy() {
				ro.disconnect();
				mo.disconnect();
				delete overflowStacks[stackId];
			}
		};
	}

	function toggleOverflow(stackId: string, btnRect: DOMRect) {
		if (openOverflowId === stackId) {
			openOverflowId = null;
			overflowPos = null;
		} else {
			openOverflowId = stackId;
			overflowPos = {
				top: btnRect.bottom + 2,
				right: window.innerWidth - btnRect.right,
			};
		}
	}

	async function scrollTabIntoView(stackId: string, tabIdx: number) {
		await tick();
		const stackEl = rootEl?.querySelector(`[data-stack-id="${stackId}"]`);
		if (!stackEl) return;
		const container = stackEl.querySelector<HTMLElement>('.jsl-tabs-scroll');
		if (!container) return;
		const tabEl = container.querySelector<HTMLElement>(`[data-jsl-tab-idx="${tabIdx}"]`);
		if (tabEl) tabEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
	}
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
<div class="jsl-root {className}" style={styleAttr} bind:this={rootEl}>
	{@render layoutNode(layout.root)}

	<!-- Root-edge drop overlay (full-width/height docking) -->
	{#if layout.dropZone?.rootEdge && layout.dragging?.active}
		{@const side = layout.dropZone.side}
		<div class="jsl-drop-overlay jsl-root-drop">
			<div
				class="jsl-drop-zone"
				class:jsl-drop-left={side === 'left'}
				class:jsl-drop-right={side === 'right'}
				class:jsl-drop-top={side === 'top'}
				class:jsl-drop-bottom={side === 'bottom'}
			></div>
		</div>
	{/if}

	<!-- Overflow dropdown (position:fixed escapes overflow:hidden on ancestors) -->
	{#if openOverflowId && overflowPos}
		{@const overflowStack = findStack(layout.root, openOverflowId)}
		{#if overflowStack}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="jsl-overflow-backdrop" onclick={() => { openOverflowId = null; overflowPos = null; }}></div>
			<div class="jsl-overflow-dropdown" style="top:{overflowPos.top}px; right:{overflowPos.right}px;">
				{#each overflowStack.tabs as tab, i (tab.id)}
					<button
						class="jsl-overflow-item"
						class:jsl-overflow-item-active={i === overflowStack.activeTab}
						onclick={() => {
							layout.activateTab(openOverflowId!, i);
							const sid = openOverflowId!;
							openOverflowId = null;
							overflowPos = null;
							scrollTabIntoView(sid, i);
						}}
					>
						{#if renderTabIcon}
							<span class="jsl-tab-icon-inline">{@render renderTabIcon(tab)}</span>
						{/if}
						<span>{tab.title}</span>
					</button>
				{/each}
			</div>
		{/if}
	{/if}
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
	<!-- Symmetric guard to stackPanel: during teardown, a split may flip to
	     stack and node.children becomes undefined. -->
	{@const children = node.children ?? []}
	<div
		class="jsl-split"
		class:jsl-row={node.type === 'row'}
		class:jsl-col={node.type === 'column'}
		data-split-id={node.id}
	>
		{#each children as child, i (child.id)}
			<div
				class="jsl-child"
				style="flex: {child.size} 1 0%;"
			>
				{@render layoutNode(child)}
			</div>

			{#if i < children.length - 1}
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
	<!-- Guard: during split() teardown, Svelte may re-evaluate @const deriveds
	     against a node whose type just flipped from stack to split. node.tabs
	     would be undefined, crashing `node.tabs[node.activeTab]` with
	     "Cannot read properties of undefined (reading 'undefined')". -->
	{@const tabs = node.tabs ?? []}
	{@const activeTabIdx = node.activeTab ?? 0}
	{@const activeTab = tabs[activeTabIdx]}
	{@const isDropTarget = layout.dropZone?.stackId === node.id}
	{@const isDragSource = layout.dragging?.sourceStackId === node.id}
	{@const isOnlyStack = layout.root.type === 'stack'}
	{@const isCollapsed = !!collapsedStacks[node.id]}
	<div
		class="jsl-stack"
		class:jsl-stack-collapsed={isCollapsed}
		data-stack-id={node.id}
		onpointerdown={() => layout.activateTab(node.id, node.activeTab)}
	>
		<!-- Collapse/expand hover strip (always at top of stack) -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="jsl-collapse-zone"
			class:jsl-collapse-zone-collapsed={isCollapsed}
			title={isCollapsed ? 'Show tab bar' : 'Hide tab bar'}
			onpointerdown={(e) => e.stopPropagation()}
			onclick={(e) => {
				e.stopPropagation();
				collapsedStacks[node.id] = !isCollapsed;
			}}
		></div>

		{#if !isCollapsed}
		<!-- Tab bar -->
		<div class="jsl-tab-bar" style="height:{tabBarHeight}px;" data-jsl-tab-bar>
			<!-- Scrollable tabs container (hidden scrollbar, wheel/trackpad still works) -->
			<div class="jsl-tabs-scroll" use:observeOverflow={node.id}>
				{#each tabs as tab, i (tab.id)}
					{@const isActive = i === activeTabIdx}
					{@const isBeingDragged = isDragSource && layout.dragging?.active && layout.dragging.sourceTabIdx === i}
					<div
						class="jsl-tab"
						class:jsl-tab-active={isActive}
						class:jsl-tab-dragging={isBeingDragged}
						class:jsl-tab-pinned={tab.pinned}
						role="tab"
						tabindex="0"
						data-jsl-tab-idx={i}
						style={tabTopEdgeStyle(tab, isActive)}
						onpointerdown={(e) => {
							layout.activateTab(node.id, i);
							layout.startTabDrag(e, tab, node.id, i);
						}}
					>
						{#if renderTabIcon}
							<span class="jsl-tab-icon-inline">{@render renderTabIcon(tab)}</span>
						{/if}
						<span class="jsl-tab-label">{tab.title}</span>
						<span class="jsl-tab-actions">
							{#if !(isOnlyStack && tabs.length <= 1)}
								<button
									class="jsl-tab-btn jsl-tab-close"
									onpointerdown={(e) => e.stopPropagation()}
									onclick={async (e) => {
										e.stopPropagation();
										if (e.shiftKey) {
											if (onshiftclose) onshiftclose(node.id, [...tabs]);
											else layout.removeStack(node.id);
										} else {
											if (layout.canRemoveTab) {
												const allowed = await layout.canRemoveTab(tab);
												if (!allowed) return;
											}
											layout.removeTab(node.id, i);
										}
									}}
								>
									<svg width="14" height="14" viewBox="0 -960 960 960" fill="currentColor">
										<path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/>
									</svg>
								</button>
							{/if}
							{#if showPinButtons}
								<button
									class="jsl-tab-btn jsl-tab-pin"
									class:jsl-tab-pin-active={tab.pinned}
									class:jsl-tab-pin-hover={pinOnHover && !tab.pinned}
									title={tab.pinned ? 'Unpin tab' : 'Pin tab'}
									onpointerdown={(e) => e.stopPropagation()}
									onclick={(e) => { e.stopPropagation(); togglePin(tab); }}
								>
									<svg width="14" height="14" viewBox="0 -960 960 960" fill={tab.pinned ? '#0ff' : 'currentColor'}>
										<path d="m643.22-499.78 96 96v98.56H529v225.74l-49 49-49-49v-225.74H220.78v-98.56l96-96v-249.31h-48v-98h422.44v98h-48v249.31Z" />
									</svg>
								</button>
							{/if}
						</span>
					</div>
				{/each}

				{#if layout.onAddTab}
					<button
						class="jsl-add-tab"
						title="Add tab"
						onpointerdown={(e) => e.stopPropagation()}
						onclick={(e) => { e.stopPropagation(); layout.onAddTab!(node.id); }}
					>
						+
					</button>
				{/if}
			</div>

			<!-- Overflow "more" button (appears when tabs don't fit) -->
			{#if overflowStacks[node.id]}
				<button
					class="jsl-overflow-btn"
					title="More tabs"
					onpointerdown={(e) => e.stopPropagation()}
					onclick={(e) => {
						e.stopPropagation();
						toggleOverflow(node.id, e.currentTarget.getBoundingClientRect());
					}}
				>
					&middot;&middot;&middot;
				</button>
			{/if}

			<!-- Area controls (always visible, never shrink) -->
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
					onclick={(e) => {
						if (e.shiftKey) {
							layout.closeStack(node.id, { preserveActiveTab: true });
						} else {
							if (onareaclose) onareaclose(node.id, [...tabs]);
							else layout.removeStack(node.id);
						}
					}}
				>
					&times;
				</button>
			</div>
		</div>
		{/if}

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
		position: relative;
	}

	/* --- Split containers --- */
	.jsl-split {
		display: flex;
		gap: 1px;
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
		background: transparent;
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
		border-radius: 6px;
		border: 1px solid #2b2b2b;
	}

	/* --- Tab bar --- */
	.jsl-tab-bar {
		display: flex;
		align-items: center;
		flex-shrink: 0;
		overflow: hidden;
		background: var(--jsl-surface);
		border-radius: 5px 5px 0 0;
	}

	/* --- Scrollable tabs container (hidden scrollbar) --- */
	.jsl-tabs-scroll {
		display: flex;
		align-items: center;
		flex: 1 1 0%;
		min-width: 0;
		overflow-x: auto;
		scrollbar-width: none;
		height: 100%;
	}
	.jsl-tabs-scroll::-webkit-scrollbar {
		display: none;
	}

	/* --- Individual tab --- */
	.jsl-tab {
		position: relative;
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
		overflow: hidden;
	}
	.jsl-tab::before {
		content: '';
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: var(--jsl-tab-top-edge-thickness, 0);
		background: var(--jsl-tab-top-edge-color, transparent);
		opacity: var(--jsl-tab-top-edge-opacity, 0);
		z-index: 1;
		pointer-events: none;
		transition: opacity 0.12s ease;
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

	.jsl-tab-icon-inline {
		display: flex;
		align-items: center;
		flex-shrink: 0;
		color: inherit;
		opacity: var(--jsl-tab-icon-opacity, 0.7);
	}

	.jsl-tab-pinned {
		cursor: default;
	}

	.jsl-tab-actions {
		display: flex;
		align-items: center;
		gap: 0;
		margin-left: 2px;
		flex-shrink: 0;
	}

	.jsl-tab-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		border-radius: 3px;
		padding: 0;
		opacity: 0;
		color: var(--jsl-text-dim);
		background: none;
		border: none;
		cursor: pointer;
		transition: opacity 0.12s, background 0.12s;
	}
	.jsl-tab-btn:hover {
		background: rgba(255, 255, 255, 0.1);
		color: var(--jsl-text);
		opacity: 1;
	}
	.jsl-tab:hover .jsl-tab-btn,
	.jsl-tab-active .jsl-tab-btn {
		opacity: 0.5;
	}

	.jsl-tab-pin-hover {
		display: none;
	}
	.jsl-tab:hover .jsl-tab-pin-hover {
		display: flex;
	}

	.jsl-tab-pin-active {
		opacity: 0.7 !important;
	}

	/* --- Add tab button --- */
	.jsl-add-tab {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		flex-shrink: 0;
		border: none;
		border-radius: 3px;
		background: none;
		color: var(--jsl-text-dim);
		font-size: 16px;
		line-height: 1;
		cursor: pointer;
		opacity: 0;
		transition: opacity 0.15s, background 0.15s;
	}
	.jsl-add-tab:hover {
		background: rgba(255, 255, 255, 0.1);
		color: var(--jsl-text);
		opacity: 1;
	}
	.jsl-stack:hover .jsl-add-tab {
		opacity: 0.6;
	}

	/* --- Area controls --- */
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

	/* --- Overflow "more" button --- */
	.jsl-overflow-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		height: 100%;
		padding: 0 6px;
		border: none;
		background: none;
		color: var(--jsl-text-dim);
		font-size: 14px;
		cursor: pointer;
		letter-spacing: 2px;
	}
	.jsl-overflow-btn:hover {
		color: var(--jsl-text);
		background: var(--jsl-tab-hover-bg);
	}

	/* --- Overflow dropdown --- */
	.jsl-overflow-backdrop {
		position: fixed;
		inset: 0;
		z-index: 99;
	}
	.jsl-overflow-dropdown {
		position: fixed;
		z-index: 100;
		min-width: 160px;
		max-width: 280px;
		max-height: 300px;
		overflow-y: auto;
		background: var(--jsl-surface);
		border: 1px solid var(--jsl-border);
		border-radius: 4px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
		padding: 2px 0;
	}
	.jsl-overflow-item {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		padding: 4px 12px;
		border: none;
		background: none;
		color: var(--jsl-text-muted);
		font-size: 12px;
		cursor: pointer;
		text-align: left;
		white-space: nowrap;
	}
	.jsl-overflow-item:hover {
		background: var(--jsl-tab-hover-bg);
		color: var(--jsl-text);
	}
	.jsl-overflow-item-active {
		color: var(--jsl-text);
		background: var(--jsl-tab-active-bg);
	}

	/* --- Content area --- */
	.jsl-content {
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}

	/* --- Tab-bar collapse/expand hover strip --- */
	.jsl-collapse-zone {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 8px;
		z-index: 15;
		/* chevron-line-up cursor (Material Symbol): line above chevron pointing up */
		cursor: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><g fill='none' stroke='black' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'><path d='M4 5h16'/><path d='M6 15l6-6 6 6'/></g><g fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M4 5h16'/><path d='M6 15l6-6 6 6'/></g></svg>") 12 4, pointer;
	}
	.jsl-collapse-zone-collapsed {
		height: 6px;
		/* chevron-line-down cursor: same as chevron-line-up, rotated 180° */
		cursor: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><g transform='rotate(180 12 12)'><g fill='none' stroke='black' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'><path d='M4 5h16'/><path d='M6 15l6-6 6 6'/></g><g fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M4 5h16'/><path d='M6 15l6-6 6 6'/></g></g></svg>") 12 20, pointer;
	}
	.jsl-collapse-zone::after {
		content: '';
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 2px;
		background: transparent;
		transition: background 0.12s, box-shadow 0.12s;
	}
	.jsl-collapse-zone:hover::after {
		background: var(--jsl-accent);
		box-shadow: 0 0 8px var(--jsl-accent), 0 0 2px var(--jsl-accent);
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

	/* Root-edge drop (higher z-index to cover all stacks) */
	.jsl-root-drop {
		z-index: 25;
	}

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
