<script lang="ts">
	import { LayoutState, LayoutArea, uid } from '../../../src/lib/index.js';
	import type { LayoutNode, Tab, StackNode } from '../../../src/lib/types.js';

	// --- Content type config ---
	const TYPES: Record<string, { color: string; icon: string }> = {
		explorer: { color: '#1e3a5f', icon: '📁' },
		editor:   { color: '#3b1f5e', icon: '✏️' },
		dag:      { color: '#1f4a3a', icon: '🔀' },
		plugin:   { color: '#4a3a1f', icon: '🧩' },
		terminal: { color: '#2a2a2a', icon: '💻' },
		details:  { color: '#1f3a4a', icon: 'ℹ️' },
	};
	const TYPE_KEYS = Object.keys(TYPES);

	// --- Default layout ---
	function makeLayout(): LayoutNode {
		return {
			type: 'row', id: uid(), size: 1,
			children: [
				{
					type: 'stack', id: uid(), size: 0.2,
					tabs: [{ id: uid(), title: 'Sidebar', contentType: 'explorer' }],
					activeTab: 0,
				},
				{
					type: 'column', id: uid(), size: 0.55,
					children: [
						{
							type: 'stack', id: uid(), size: 0.7,
							tabs: [
								{ id: uid(), title: 'Files', contentType: 'explorer' },
								{ id: uid(), title: 'Code', contentType: 'editor' },
							],
							activeTab: 0,
						},
						{
							type: 'stack', id: uid(), size: 0.3,
							tabs: [{ id: uid(), title: 'Terminal', contentType: 'terminal' }],
							activeTab: 0,
						},
					],
				},
				{
					type: 'stack', id: uid(), size: 0.25,
					tabs: [
						{ id: uid(), title: 'DAG', contentType: 'dag' },
						{ id: uid(), title: 'Details', contentType: 'details' },
						{ id: uid(), title: 'Plugin', contentType: 'plugin' },
					],
					activeTab: 0,
				},
			],
		};
	}

	const layout = new LayoutState(makeLayout());

	function addRandomTab() {
		const ct = TYPE_KEYS[Math.floor(Math.random() * TYPE_KEYS.length)];
		const tab = LayoutState.createTab(ct.charAt(0).toUpperCase() + ct.slice(1), ct);
		layout.addTabAnywhere(tab);
	}

	function resetLayout() {
		layout.setLayout(makeLayout());
	}
</script>

<div class="app">
	<!-- Toolbar -->
	<div class="toolbar">
		<span class="title">JSimpleLayout</span>
		<span class="spacer"></span>
		<button onclick={addRandomTab}>+ Tab</button>
		<button onclick={resetLayout}>Reset</button>
	</div>

	<!-- Layout -->
	<div class="layout-container">
		<LayoutArea {layout}>
			{#snippet renderContent(tab: Tab, stack: StackNode)}
				{@const cfg = TYPES[tab.contentType] ?? { color: '#333', icon: '?' }}
				<div class="placeholder" style="background:{cfg.color};">
					<span class="placeholder-icon">{cfg.icon}</span>
					<span class="placeholder-title">{tab.title}</span>
					<span class="placeholder-type">{tab.contentType}</span>
				</div>
			{/snippet}

			{#snippet renderTabIcon(tab: Tab)}
				{@const cfg = TYPES[tab.contentType]}
				<span style="font-size:12px;">{cfg?.icon ?? '?'}</span>
			{/snippet}
		</LayoutArea>
	</div>
</div>

<style>
	:global(body) {
		margin: 0;
		padding: 0;
		background: #1a1a1a;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
	}

	.app {
		display: flex;
		flex-direction: column;
		height: 100vh;
		overflow: hidden;
	}

	.toolbar {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 0 12px;
		height: 36px;
		background: #171717;
		border-bottom: 1px solid #404040;
		color: #e5e5e5;
		flex-shrink: 0;
	}

	.title {
		font-size: 13px;
		font-weight: 600;
		color: #d4d4d4;
	}

	.spacer { flex: 1; }

	.toolbar button {
		padding: 2px 8px;
		font-size: 12px;
		border-radius: 4px;
		border: none;
		background: #404040;
		color: #d4d4d4;
		cursor: pointer;
	}
	.toolbar button:hover {
		background: #525252;
	}

	.layout-container {
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}

	/* Content placeholders */
	.placeholder {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 100%;
		gap: 4px;
	}

	.placeholder-icon {
		font-size: 36px;
		opacity: 0.5;
	}

	.placeholder-title {
		font-size: 13px;
		color: rgba(255, 255, 255, 0.4);
	}

	.placeholder-type {
		font-size: 10px;
		color: rgba(255, 255, 255, 0.2);
	}
</style>
