import {useCallback, useEffect, useMemo, useRef, useState} from "react"
import type {AgentNode, Event, EventType} from "#types"
import {MarkdownContent} from "../MarkdownContent"
import {
	ALL_EVENT_TYPES,
	type FilterState,
	formatTime,
	getAgentColor,
	getEventSummary,
	getEventTypeBadgeClass,
} from "../shared"

interface ColumnsViewProps {
	agents: AgentNode[]
	events: Event[]
	baseFilteredEvents: Event[]
	filters: FilterState
	onFilterChange: (f: FilterState) => void
	selectedEvent: Event | null
	onSelectEvent: (e: Event | null) => void
}

/**
 * A display item in the center panel. Events are either shown individually,
 * grouped as tool-use/tool-result pairs, or collapsed into sub-agent task cards.
 */
type DisplayItem =
	| {kind: "message"; event: Event}
	| {kind: "tool-pair"; toolUse: Event; toolResult: Event | null; failed: boolean}
	| {
			kind: "agent-task"
			toolUse: Event
			toolResult: Event | null
			agentSpawn: Event | null
			agent: AgentNode
			failed: boolean
	  }

function buildDisplayItems(opts: {
	agentEvents: Event[]
	allEvents: Event[]
	agents: AgentNode[]
	viewedAgentId: string | null
}): DisplayItem[] {
	const {agentEvents, allEvents, agents, viewedAgentId} = opts
	const items: DisplayItem[] = []

	// Build lookup: toolUseId -> tool-result event (across all events for cross-agent results)
	const toolResultByUseId = new Map<string, Event>()
	for (const ev of allEvents) {
		if (ev.data.type === "tool-result") {
			toolResultByUseId.set(ev.data.toolUseId, ev)
		}
	}

	// Build lookup: agentId -> AgentNode
	const agentById = new Map<string, AgentNode>()
	for (const a of agents) {
		agentById.set(a.id, a)
	}

	// Build lookup: agentId -> agent-spawn event (on the parent agent)
	const agentSpawnByAgentId = new Map<string, Event>()
	for (const ev of allEvents) {
		if (ev.data.type === "agent-spawn") {
			agentSpawnByAgentId.set(ev.data.agentId, ev)
		}
	}

	// Find child agent IDs of the viewed agent
	const childAgentIds = new Set<string>()
	const viewedAgent = agentById.get(viewedAgentId ?? "")
	if (viewedAgent) {
		for (const child of viewedAgent.children) {
			childAgentIds.add(child.id)
		}
	}

	// Track tool-use IDs that spawn sub-agents so we can identify them
	// A tool-result with an agentId field means it delegated to that agent
	const toolUseToAgent = new Map<string, string>()
	for (const ev of allEvents) {
		if (ev.data.type === "tool-result" && ev.data.agentId && childAgentIds.has(ev.data.agentId)) {
			toolUseToAgent.set(ev.data.toolUseId, ev.data.agentId)
		}
	}

	// Also check: tool-use events with toolName "Task" or matching agent-spawn agentIds
	// via the agent-spawn events that reference child agents
	for (const ev of agentEvents) {
		if (ev.data.type === "tool-use") {
			// Check if there's an agent-spawn for any child that references this tool
			for (const child of viewedAgent?.children ?? []) {
				const spawn = agentSpawnByAgentId.get(child.id)
				if (spawn && !toolUseToAgent.has(ev.data.toolId)) {
					// Match by proximity: if the agent-spawn timestamp is close to this tool-use
					const timeDiff = Math.abs(spawn.timestamp.getTime() - ev.timestamp.getTime())
					if (timeDiff < 5000) {
						toolUseToAgent.set(ev.data.toolId, child.id)
					}
				}
			}
		}
	}

	const consumedEventIds = new Set<string>()
	const eventList = [...agentEvents]

	for (let i = 0; i < eventList.length; i++) {
		const ev = eventList[i]
		if (!ev || consumedEventIds.has(ev.id)) continue

		if (ev.data.type === "tool-use") {
			const toolId = ev.data.toolId
			const result = toolResultByUseId.get(toolId) ?? null
			const spawnsAgentId = toolUseToAgent.get(toolId)
			const failed = result
				? !result.data.type || (result.data.type === "tool-result" && !result.data.success)
				: false

			if (result) consumedEventIds.add(result.id)

			if (spawnsAgentId) {
				const agent = agentById.get(spawnsAgentId)
				const spawn = agentSpawnByAgentId.get(spawnsAgentId) ?? null
				if (agent) {
					items.push({
						kind: "agent-task",
						toolUse: ev,
						toolResult: result,
						agentSpawn: spawn,
						agent,
						failed,
					})
					continue
				}
			}

			items.push({kind: "tool-pair", toolUse: ev, toolResult: result, failed})
			continue
		}

		if (ev.data.type === "tool-result") {
			// Already consumed as part of a pair above, skip standalone
			if (consumedEventIds.has(ev.id)) continue
			// Orphaned tool-result — show as message
			items.push({kind: "message", event: ev})
			continue
		}

		// Agent-spawn events on the viewed agent are handled as part of agent-task cards
		if (ev.data.type === "agent-spawn" && childAgentIds.has(ev.data.agentId)) {
			consumedEventIds.add(ev.id)
			continue
		}

		items.push({kind: "message", event: ev})
	}

	return items
}

function getAgentBreadcrumb(agents: AgentNode[], targetId: string | null): AgentNode[] {
	if (!targetId) return []

	const agentById = new Map<string, AgentNode>()
	for (const a of agents) {
		agentById.set(a.id, a)
	}

	const path: AgentNode[] = []
	let current = agentById.get(targetId)
	while (current) {
		path.unshift(current)
		current = current.parent ? agentById.get(current.parent) : undefined
	}
	return path
}

export function ColumnsView({
	agents,
	events,
	baseFilteredEvents,
	filters,
	onFilterChange,
	selectedEvent,
	onSelectEvent,
}: ColumnsViewProps) {
	const [rightPanelOpen, setRightPanelOpen] = useState(false)
	const [leftWidth, setLeftWidth] = useState(250)
	const [rightWidth, setRightWidth] = useState(500)
	const [viewedAgentId, setViewedAgentId] = useState<string | null>(() => agents[0]?.id ?? null)
	// Maps childAgentId -> toolUseId in the parent that was clicked to drill in
	const [returnAnchors, setReturnAnchors] = useState<Map<string, string>>(new Map())
	const [scrollToId, setScrollToId] = useState<string | null>(null)
	const centerPanelRef = useRef<HTMLDivElement>(null)

	// Reset viewed agent and return anchors when agents change (new session loaded)
	useEffect(() => {
		if (agents.length > 0 && !agents.find((a) => a.id === viewedAgentId)) {
			setViewedAgentId(agents[0]?.id ?? null)
			setReturnAnchors(new Map())
		}
	}, [agents, viewedAgentId])

	// Scroll to anchored item after agent navigation
	useEffect(() => {
		if (!scrollToId || !centerPanelRef.current) return
		const el = centerPanelRef.current.querySelector(`[data-item-id="${scrollToId}"]`)
		if (el) el.scrollIntoView({behavior: "smooth", block: "center"})
		setScrollToId(null)
	}, [scrollToId])

	const handleDrillIn = useCallback((childAgentId: string, toolUseId: string) => {
		setReturnAnchors((prev) => new Map(prev).set(childAgentId, toolUseId))
		setViewedAgentId(childAgentId)
	}, [])

	const handleNavigateToAgent = useCallback(
		(targetAgentId: string) => {
			// Find the immediate child of the target that is on the path to the current agent.
			// returnAnchors is keyed by child agent id, so for any ancestor jump we need
			// the child-on-path (one step below target in the breadcrumb) as the key.
			const currentPath = getAgentBreadcrumb(agents, viewedAgentId ?? "")
			const targetIdx = currentPath.findIndex((n) => n.id === targetAgentId)
			const childOnPath = targetIdx >= 0 ? currentPath[targetIdx + 1] : undefined
			const anchor = childOnPath ? returnAnchors.get(childOnPath.id) : undefined
			setViewedAgentId(targetAgentId)
			if (anchor) setScrollToId(anchor)
		},
		[returnAnchors, viewedAgentId, agents],
	)

	const handleSelectEvent = useCallback(
		(event: Event | null) => {
			onSelectEvent(event)
			setRightPanelOpen(event !== null)
		},
		[onSelectEvent],
	)

	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				if (rightPanelOpen) {
					setRightPanelOpen(false)
					onSelectEvent(null)
				}
			}
		}
		window.addEventListener("keydown", handler)
		return () => window.removeEventListener("keydown", handler)
	}, [rightPanelOpen, onSelectEvent])

	const toggleEventType = (type: EventType) => {
		const next = new Set(filters.eventTypes)
		if (next.has(type)) {
			next.delete(type)
		} else {
			next.add(type)
		}
		onFilterChange({...filters, eventTypes: next})
	}

	const setSearchText = (searchText: string) => {
		onFilterChange({...filters, searchText})
	}

	const hasActiveTypeFilter = filters.eventTypes.size > 0

	// Events for the currently viewed agent, applying type/search filters only
	const viewedAgentEvents = useMemo(() => {
		return baseFilteredEvents.filter((ev) => (ev.agentId ?? "") === (viewedAgentId ?? ""))
	}, [baseFilteredEvents, viewedAgentId])

	// Build display items for the center panel
	const displayItems = useMemo(() => {
		return buildDisplayItems({agentEvents: viewedAgentEvents, allEvents: events, agents, viewedAgentId})
	}, [viewedAgentEvents, events, agents, viewedAgentId])

	// Count events per agent from base filtered events
	const agentEventCounts = new Map<string, number>()
	for (const event of baseFilteredEvents) {
		const id = event.agentId ?? ""
		agentEventCounts.set(id, (agentEventCounts.get(id) ?? 0) + 1)
	}

	const breadcrumb = useMemo(() => getAgentBreadcrumb(agents, viewedAgentId), [agents, viewedAgentId])
	const isMainAgent = viewedAgentId === agents[0]?.id

	return (
		<div className="flex gap-0 h-[calc(100vh-200px)] bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
			{/* Left panel: agent tree + filters */}
			<div
				className="flex-shrink-0 border-r border-gray-800 flex flex-col overflow-hidden"
				style={{width: leftWidth}}
			>
				{/* Search */}
				<div className="p-3 border-b border-gray-800">
					<input
						type="text"
						placeholder="Search..."
						value={filters.searchText}
						onChange={(e) => setSearchText(e.target.value)}
						className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
					/>
				</div>

				{/* Agent tree */}
				<div className="flex-1 overflow-y-auto p-2">
					<div className="text-xs text-gray-500 font-medium px-2 mb-2">Agents</div>

					{agents.map((agent) => {
						const color = getAgentColor(agents, agent.id)
						const eventCount = agentEventCounts.get(agent.id) ?? 0
						const isViewed = viewedAgentId === agent.id
						const depth = getAgentDepth(agents, agent.id)
						return (
							<button
								key={agent.id}
								type="button"
								onClick={() => setViewedAgentId(agent.id)}
								className={`w-full text-left py-1.5 rounded text-sm transition-colors flex items-center gap-2 ${
									isViewed ? "bg-blue-900/50 text-blue-200" : "text-gray-400 hover:bg-gray-800"
								}`}
								style={{paddingLeft: `${8 + depth * 12}px`, paddingRight: "8px"}}
							>
								<div className="w-2 h-2 rounded-full flex-shrink-0" style={{backgroundColor: color}} />
								<span className="truncate flex-1">{agent.name || agent.id.slice(0, 12)}</span>
								<span className="text-xs text-gray-600">{eventCount}</span>
							</button>
						)
					})}

					{/* Event type filters */}
					<div className="text-xs text-gray-500 font-medium px-2 mt-4 mb-2">Event Types</div>
					{ALL_EVENT_TYPES.map((type) => {
						const isIncluded = filters.eventTypes.has(type)
						return (
							<button
								key={type}
								type="button"
								onClick={() => toggleEventType(type)}
								className={`w-full text-left px-2 py-1 rounded text-xs transition-opacity mb-0.5 ${getEventTypeBadgeClass(type)} ${
									hasActiveTypeFilter
										? isIncluded
											? "opacity-100"
											: "opacity-20"
										: "opacity-60 hover:opacity-90"
								}`}
							>
								{type}
							</button>
						)
					})}
				</div>

				{/* Resize handle */}
				<DragHandle onDrag={(delta) => setLeftWidth((w) => Math.max(180, Math.min(400, w + delta)))} />
			</div>

			{/* Center panel: event stream */}
			<div ref={centerPanelRef} className="flex-1 overflow-y-auto min-w-0">
				{/* Breadcrumb navigation */}
				{!isMainAgent && (
					<div className="sticky top-0 z-10 bg-gray-900/95 backdrop-blur-sm border-b border-gray-800 px-4 py-2.5 flex items-center gap-1.5 text-sm">
						{/* Back button */}
						<button
							type="button"
							onClick={() => handleNavigateToAgent(breadcrumb.at(-2)?.id ?? agents[0]?.id ?? "")}
							className="mr-1 text-gray-400 hover:text-gray-200 transition-colors flex items-center gap-1"
						>
							<svg
								aria-hidden="true"
								className="w-3.5 h-3.5"
								fill="none"
								viewBox="0 0 24 24"
								strokeWidth={2.5}
								stroke="currentColor"
							>
								<path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
							</svg>
							Back
						</button>
						<span className="text-gray-700 mr-1">|</span>
						{breadcrumb.map((node, i) => {
							const isLast = i === breadcrumb.length - 1
							const color = getAgentColor(agents, node.id)
							return (
								<span key={node.id} className="flex items-center gap-1.5">
									{i > 0 && <span className="text-gray-600">/</span>}
									{isLast ? (
										<span className="text-gray-200 font-medium flex items-center gap-1.5">
											<span className="inline-block w-2 h-2 rounded-full" style={{backgroundColor: color}} />
											{node.name || node.id.slice(0, 12)}
										</span>
									) : (
										<button
											type="button"
											onClick={() => handleNavigateToAgent(node.id)}
											className="text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1.5"
										>
											<span className="inline-block w-2 h-2 rounded-full" style={{backgroundColor: color}} />
											{node.name || node.id.slice(0, 12)}
										</button>
									)}
								</span>
							)
						})}
					</div>
				)}

				{displayItems.length === 0 ? (
					<div className="text-center py-12 text-gray-500">No events for this agent</div>
				) : (
					<div>
						{displayItems.map((item) => {
							if (item.kind === "message") {
								return (
									<MessageRow
										key={item.event.id}
										itemId={item.event.id}
										event={item.event}
										agents={agents}
										isSelected={selectedEvent?.id === item.event.id}
										onSelect={handleSelectEvent}
									/>
								)
							}
							if (item.kind === "tool-pair") {
								return (
									<ToolPairRow
										key={item.toolUse.id}
										itemId={item.toolUse.id}
										toolUse={item.toolUse}
										toolResult={item.toolResult}
										failed={item.failed}
										agents={agents}
										selectedEventId={selectedEvent?.id ?? null}
										onSelect={handleSelectEvent}
									/>
								)
							}
							return (
								<AgentTaskCard
									key={item.toolUse.id}
									itemId={item.toolUse.id}
									item={item}
									agents={agents}
									onDrillIn={() => handleDrillIn(item.agent.id, item.toolUse.id)}
								/>
							)
						})}
					</div>
				)}
			</div>

			{/* Right panel: event details */}
			{rightPanelOpen && selectedEvent && (
				<>
					{/* Resize handle */}
					<DragHandle onDrag={(delta) => setRightWidth((w) => Math.max(300, Math.min(800, w - delta)))} />

					<div className="flex-shrink-0 border-l border-gray-800 overflow-y-auto" style={{width: rightWidth}}>
						<div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 sticky top-0 bg-gray-900 z-10">
							<span className={`text-xs px-2 py-0.5 rounded ${getEventTypeBadgeClass(selectedEvent.type)}`}>
								{selectedEvent.type}
							</span>
							<button
								type="button"
								onClick={() => {
									setRightPanelOpen(false)
									onSelectEvent(null)
								}}
								className="text-gray-500 hover:text-gray-300 text-xs"
							>
								Close (Esc)
							</button>
						</div>

						{/* Agent info */}
						<div className="px-4 py-3 border-b border-gray-800">
							<div className="text-xs text-gray-500 space-y-1">
								<div>
									<span className="text-gray-600">Agent:</span>{" "}
									<span className="text-gray-300">
										{selectedEvent.agentName || selectedEvent.agentId || "main"}
									</span>
								</div>
								<div>
									<span className="text-gray-600">Time:</span>{" "}
									<span className="font-mono text-gray-300">{formatTime(selectedEvent.timestamp)}</span>
								</div>
								<div>
									<span className="text-gray-600">ID:</span>{" "}
									<span className="font-mono text-gray-400">{selectedEvent.id}</span>
								</div>
							</div>
						</div>

						{/* Content */}
						<div className="p-4">
							<ColumnsEventContent event={selectedEvent} />
						</div>
					</div>
				</>
			)}
		</div>
	)
}

function getAgentDepth(agents: AgentNode[], agentId: string): number {
	const agent = agents.find((a) => a.id === agentId)
	if (!agent || !agent.parent) return 0
	return 1 + getAgentDepth(agents, agent.parent)
}

function MessageRow({
	itemId,
	event,
	agents,
	isSelected,
	onSelect,
}: {
	itemId: string
	event: Event
	agents: AgentNode[]
	isSelected: boolean
	onSelect: (e: Event | null) => void
}) {
	const color = getAgentColor(agents, event.agentId)
	return (
		<button
			type="button"
			data-item-id={itemId}
			onClick={() => onSelect(isSelected ? null : event)}
			className={`w-full text-left px-4 py-3 border-b border-gray-800/50 transition-colors ${
				isSelected ? "bg-blue-900/20" : "hover:bg-gray-800/50"
			}`}
		>
			<div className="flex items-center gap-3 mb-1">
				<div className="w-2 h-2 rounded-full flex-shrink-0" style={{backgroundColor: color}} />
				<span className={`text-xs px-1.5 py-0.5 rounded ${getEventTypeBadgeClass(event.type)}`}>
					{event.type}
				</span>
				<span className="text-xs text-gray-600 font-mono ml-auto flex-shrink-0">
					{formatTime(event.timestamp)}
				</span>
			</div>
			<div className="text-sm text-gray-300 truncate pl-5">{getEventSummary(event)}</div>
		</button>
	)
}

function ToolPairRow({
	itemId,
	toolUse,
	toolResult,
	failed,
	agents,
	selectedEventId,
	onSelect,
}: {
	itemId: string
	toolUse: Event
	toolResult: Event | null
	failed: boolean
	agents: AgentNode[]
	selectedEventId: string | null
	onSelect: (e: Event | null) => void
}) {
	const color = getAgentColor(agents, toolUse.agentId)
	const isUseSelected = selectedEventId === toolUse.id
	const isResultSelected = toolResult ? selectedEventId === toolResult.id : false
	const isSelected = isUseSelected || isResultSelected

	const toolName = toolUse.data.type === "tool-use" ? toolUse.data.toolName : "tool"
	const description = toolUse.data.type === "tool-use" ? toolUse.data.description : undefined

	const resultOutput = toolResult?.data.type === "tool-result" ? toolResult.data.output : null
	const resultSuccess = toolResult?.data.type === "tool-result" ? toolResult.data.success : null

	return (
		<div
			data-item-id={itemId}
			className={`border-b border-gray-800/50 transition-colors ${
				isSelected ? "bg-blue-900/20" : "hover:bg-gray-800/30"
			} ${failed ? "border-l-2 border-l-red-500/70" : ""}`}
		>
			{/* Tool use line */}
			<button
				type="button"
				onClick={() => onSelect(isUseSelected ? null : toolUse)}
				className="w-full text-left px-4 py-2"
			>
				<div className="flex items-center gap-3">
					<div className="w-2 h-2 rounded-full flex-shrink-0" style={{backgroundColor: color}} />
					<span className="text-xs font-medium text-blue-300">{toolName}</span>
					{description && <span className="text-xs text-gray-500 truncate flex-1">{description}</span>}
					<span className="text-xs text-gray-600 font-mono ml-auto flex-shrink-0">
						{formatTime(toolUse.timestamp)}
					</span>
				</div>
			</button>

			{/* Tool result line */}
			{toolResult && (
				<button
					type="button"
					onClick={() => onSelect(isResultSelected ? null : toolResult)}
					className="w-full text-left px-4 py-1.5 pb-2"
				>
					<div className="flex items-center gap-3 pl-5">
						{resultSuccess === false ? (
							<span className="text-xs text-red-400 font-medium">Error</span>
						) : (
							<span className="text-xs text-green-400/70">OK</span>
						)}
						{resultOutput && (
							<span className="text-xs text-gray-500 truncate flex-1">{resultOutput.substring(0, 100)}</span>
						)}
						<span className="text-xs text-gray-600 font-mono ml-auto flex-shrink-0">
							{formatTime(toolResult.timestamp)}
						</span>
					</div>
				</button>
			)}
		</div>
	)
}

function AgentTaskCard({
	itemId,
	item,
	agents,
	onDrillIn,
}: {
	itemId: string
	item: Extract<DisplayItem, {kind: "agent-task"}>
	agents: AgentNode[]
	onDrillIn: () => void
}) {
	const agentColor = getAgentColor(agents, item.agent.id)
	const spawnData = item.agentSpawn?.data.type === "agent-spawn" ? item.agentSpawn.data : null
	const resultData = item.toolResult?.data.type === "tool-result" ? item.toolResult.data : null

	const agentName = item.agent.name || item.agent.id.slice(0, 16)
	const prompt = spawnData?.prompt ?? ""
	const description = spawnData?.description ?? item.agent.description ?? ""
	const output = resultData?.output ?? ""
	const success = resultData?.success ?? true

	return (
		<div data-item-id={itemId} className="border-b border-gray-800/50">
			<div
				className="mx-3 my-2 rounded-lg border overflow-hidden transition-colors hover:border-gray-600"
				style={{borderColor: `${agentColor}40`}}
			>
				{/* Header bar */}
				<div className="px-4 py-2.5 flex items-center gap-3" style={{backgroundColor: `${agentColor}10`}}>
					<div className="w-3 h-3 rounded-full flex-shrink-0" style={{backgroundColor: agentColor}} />
					<span className="text-sm font-medium text-gray-200">{agentName}</span>
					{description && <span className="text-xs text-gray-500 truncate flex-1">{description}</span>}
					{!success && (
						<span className="text-xs bg-red-900/60 text-red-300 px-1.5 py-0.5 rounded">failed</span>
					)}
					<span className="text-xs text-gray-600 font-mono flex-shrink-0">
						{formatTime(item.toolUse.timestamp)}
					</span>
				</div>

				{/* Body */}
				<div className="px-4 py-3 space-y-2">
					{/* Prompt (input) */}
					{prompt && (
						<div>
							<div className="text-xs text-gray-500 mb-1">Prompt</div>
							<div className="text-xs text-gray-400 line-clamp-3 whitespace-pre-wrap">{prompt}</div>
						</div>
					)}

					{/* Result (output) */}
					{output && (
						<div>
							<div className="text-xs text-gray-500 mb-1">Result</div>
							<div
								className={`text-xs line-clamp-3 whitespace-pre-wrap ${
									success ? "text-gray-400" : "text-red-400/80"
								}`}
							>
								{output}
							</div>
						</div>
					)}
				</div>

				{/* Footer with drill-in button */}
				<div className="px-4 py-2 border-t" style={{borderColor: `${agentColor}20`}}>
					<button
						type="button"
						onClick={onDrillIn}
						className="text-xs font-medium transition-colors flex items-center gap-1.5"
						style={{color: agentColor}}
					>
						View agent events
						<svg
							className="w-3 h-3"
							fill="none"
							viewBox="0 0 24 24"
							strokeWidth={2}
							stroke="currentColor"
							role="img"
							aria-label="Navigate to agent"
						>
							<path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
						</svg>
					</button>
				</div>
			</div>
		</div>
	)
}

function DragHandle({onDrag}: {onDrag: (delta: number) => void}) {
	const handleMouseDown = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault()
			const startX = e.clientX

			const handleMouseMove = (moveEvent: MouseEvent) => {
				onDrag(moveEvent.clientX - startX)
			}

			const handleMouseUp = () => {
				document.removeEventListener("mousemove", handleMouseMove)
				document.removeEventListener("mouseup", handleMouseUp)
			}

			document.addEventListener("mousemove", handleMouseMove)
			document.addEventListener("mouseup", handleMouseUp)
		},
		[onDrag],
	)

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: drag handle requires mouse interaction
		<div
			className="w-1 cursor-col-resize bg-gray-800 hover:bg-blue-600 transition-colors flex-shrink-0"
			onMouseDown={handleMouseDown}
		/>
	)
}

function ColumnsEventContent({event}: {event: Event}) {
	const {data} = event

	switch (data.type) {
		case "user-message":
		case "assistant-message":
			return (
				<div className="bg-gray-800 p-4 rounded border border-gray-700">
					<MarkdownContent>{data.text}</MarkdownContent>
				</div>
			)
		case "thinking":
			return (
				<div className="bg-gray-800 p-4 rounded border border-gray-700">
					<div className="text-xs text-purple-400 mb-2 font-medium">Thinking</div>
					<MarkdownContent className="text-gray-400">{data.content}</MarkdownContent>
				</div>
			)
		case "tool-use":
			return (
				<div className="space-y-3">
					<div className="text-sm">
						<span className="text-blue-400 font-semibold">{data.toolName}</span>
						{data.description && <span className="text-gray-400 ml-2">- {data.description}</span>}
					</div>
					<pre className="text-xs text-gray-300 whitespace-pre-wrap bg-gray-800 p-4 rounded border border-gray-700 overflow-x-auto">
						{JSON.stringify(data.input, null, 2)}
					</pre>
				</div>
			)
		case "tool-result":
			return (
				<div className="space-y-3">
					<div className={`text-sm font-medium ${data.success ? "text-green-400" : "text-red-400"}`}>
						{data.success ? "Success" : "Error"} ({data.output.length} chars)
					</div>
					<pre className="text-xs text-gray-300 whitespace-pre-wrap bg-gray-800 p-4 rounded border border-gray-700 overflow-x-auto max-h-96 overflow-y-auto">
						{data.output}
					</pre>
				</div>
			)
		case "agent-spawn":
			return (
				<div className="space-y-3">
					<div className="text-sm text-blue-400 font-mono">{data.agentId}</div>
					{data.description && <div className="text-sm text-gray-400">{data.description}</div>}
					{data.model && <div className="text-xs text-gray-500">Model: {data.model}</div>}
					<div className="bg-gray-800 p-4 rounded border border-gray-700">
						<MarkdownContent>{data.prompt}</MarkdownContent>
					</div>
				</div>
			)
		case "summary":
			return (
				<div className="text-sm text-gray-300 bg-gray-800 p-4 rounded border border-gray-700">
					{data.summary}
				</div>
			)
		default:
			return (
				<pre className="text-xs text-gray-500 whitespace-pre-wrap bg-gray-800 p-4 rounded border border-gray-700">
					{JSON.stringify(data, null, 2)}
				</pre>
			)
	}
}
