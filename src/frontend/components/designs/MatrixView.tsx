import {useCallback, useEffect, useMemo, useRef, useState} from "react"
import type {AgentNode, Event} from "#types"
import {MarkdownContent} from "../MarkdownContent"
import {SharedFilters} from "../SharedFilters"
import {type FilterState, formatTime, getAgentColor, getEventSummary, getEventTypeBadgeClass} from "../shared"

interface MatrixViewProps {
	agents: AgentNode[]
	events: Event[]
	filters: FilterState
	onFilterChange: (f: FilterState) => void
}

/** Tile size constants for the grid cells */
const TILE_H = 40
const TILE_GAP = 2

/** Map event types to single-character glyphs for compact tile display */
function typeGlyph(type: string): string {
	const glyphs: Record<string, string> = {
		"user-message": "U",
		"assistant-message": "A",
		thinking: "T",
		"tool-use": "F",
		"tool-result": "R",
		"agent-spawn": "S",
		summary: "Z",
	}
	return glyphs[type] ?? "?"
}

/** Muted tile background per event type -- just enough to distinguish without overwhelming */
function tileBg(type: string): string {
	const bgs: Record<string, string> = {
		"user-message": "bg-cyan-950/60",
		"assistant-message": "bg-purple-950/60",
		thinking: "bg-purple-950/40",
		"tool-use": "bg-blue-950/60",
		"tool-result": "bg-emerald-950/60",
		"agent-spawn": "bg-amber-950/60",
		summary: "bg-gray-800/60",
	}
	return bgs[type] ?? "bg-gray-800/40"
}

/** A row in the matrix: either a single event, a paired tool call, or a collapsed sub-agent group */
type MatrixRow =
	| {kind: "event"; event: Event; agentId: string}
	| {kind: "tool-pair"; useEvent: Event; resultEvent: Event; agentId: string}
	| {kind: "agent-group"; agent: AgentNode; agentId: string; events: Event[]; rows: MatrixRow[]}

/** Pair tool-use events with their corresponding tool-result, and leave unpaired events as-is */
function pairToolCalls(events: Event[]): MatrixRow[] {
	const resultByToolUseId = new Map<string, Event>()
	for (const event of events) {
		if (event.data.type === "tool-result") {
			resultByToolUseId.set(event.data.toolUseId, event)
		}
	}

	const consumedResultIds = new Set<string>()
	const rows: MatrixRow[] = []

	for (const event of events) {
		if (event.data.type === "tool-use") {
			const result = resultByToolUseId.get(event.data.toolId)
			if (result) {
				consumedResultIds.add(result.id)
				rows.push({
					kind: "tool-pair",
					useEvent: event,
					resultEvent: result,
					agentId: event.agentId ?? "",
				})
				continue
			}
		}

		if (event.data.type === "tool-result" && consumedResultIds.has(event.id)) {
			continue
		}

		rows.push({kind: "event", event, agentId: event.agentId ?? ""})
	}

	return rows
}

/** Build matrix rows: group events by agent, pair tool calls, collapse sub-agents */
function buildMatrixRows(events: Event[], agents: AgentNode[]): MatrixRow[] {
	const mainAgentId = agents[0]?.id ?? ""

	// Separate events by agent
	const mainEvents: Event[] = []
	const subAgentEvents = new Map<string, Event[]>()

	for (const event of events) {
		const agentId = event.agentId ?? mainAgentId
		if (agentId === mainAgentId) {
			mainEvents.push(event)
		} else {
			const existing = subAgentEvents.get(agentId) ?? []
			existing.push(event)
			subAgentEvents.set(agentId, existing)
		}
	}

	// Build a lookup of agent nodes by ID for sub-agent metadata
	const agentById = new Map<string, AgentNode>()
	for (const agent of agents) {
		agentById.set(agent.id, agent)
	}

	// Process main agent events, inserting agent-group rows where agent-spawn events occur
	const pairedMain = pairToolCalls(mainEvents)
	const rows: MatrixRow[] = []

	for (const row of pairedMain) {
		rows.push(row)

		// After an agent-spawn event from the main agent, insert the sub-agent group
		const spawnEvent = row.kind === "event" ? row.event : row.kind === "tool-pair" ? row.useEvent : null
		if (spawnEvent?.data.type === "agent-spawn") {
			const spawnedAgentId = spawnEvent.data.agentId
			const subEvents = subAgentEvents.get(spawnedAgentId)
			const agentNode = agentById.get(spawnedAgentId)
			if (subEvents && subEvents.length > 0 && agentNode) {
				rows.push({
					kind: "agent-group",
					agent: agentNode,
					agentId: spawnedAgentId,
					events: subEvents,
					rows: pairToolCalls(subEvents),
				})
				subAgentEvents.delete(spawnedAgentId)
			}
		}
	}

	// Append any remaining sub-agent events that weren't matched to a spawn event
	for (const [agentId, subEvents] of subAgentEvents) {
		const agentNode = agentById.get(agentId)
		if (agentNode && subEvents.length > 0) {
			rows.push({
				kind: "agent-group",
				agent: agentNode,
				agentId,
				events: subEvents,
				rows: pairToolCalls(subEvents),
			})
		}
	}

	return rows
}

/** Extract a unique key for a matrix row */
function rowKey(row: MatrixRow): string {
	switch (row.kind) {
		case "event":
			return row.event.id
		case "tool-pair":
			return `tp-${row.useEvent.id}`
		case "agent-group":
			return `ag-${row.agentId}`
	}
}

export function MatrixView({agents, events, filters, onFilterChange}: MatrixViewProps) {
	const [expandedId, setExpandedId] = useState<string | null>(null)
	const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set())
	const expandedRef = useRef<HTMLDivElement | null>(null)

	const matrixRows = useMemo(() => buildMatrixRows(events, agents), [events, agents])

	// Build the column structure: one column per agent
	const agentColumns = useMemo(() => {
		if (agents.length === 0) return []
		return agents.map((agent) => ({
			id: agent.id,
			name: agent.name || agent.id.slice(0, 8),
			color: getAgentColor(agents, agent.id),
		}))
	}, [agents])

	const toggleExpand = useCallback((id: string) => {
		setExpandedId((prev) => (prev === id ? null : id))
	}, [])

	const toggleAgent = useCallback((agentId: string) => {
		setExpandedAgents((prev) => {
			const next = new Set(prev)
			if (next.has(agentId)) {
				next.delete(agentId)
			} else {
				next.add(agentId)
			}
			return next
		})
	}, [])

	// Escape to close expanded tile
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape" && expandedId) {
				setExpandedId(null)
			}
		}
		window.addEventListener("keydown", handler)
		return () => window.removeEventListener("keydown", handler)
	}, [expandedId])

	// Scroll expanded card into view
	useEffect(() => {
		if (expandedId && expandedRef.current) {
			expandedRef.current.scrollIntoView({behavior: "smooth", block: "nearest"})
		}
	}, [expandedId])

	const colCount = agentColumns.length || 1

	const gridTemplateColumns = `64px repeat(${colCount}, minmax(120px, 1fr))`

	/** Render a single event tile in the grid */
	function renderEventRow(event: Event, agentId: string, rowIdx: number) {
		const colIdx = agentColumns.findIndex((c) => c.id === agentId)
		const isExpanded = expandedId === event.id
		const agentColor = getAgentColor(agents, event.agentId)

		return (
			<div key={event.id}>
				<div className="grid gap-px" style={{gridTemplateColumns, minHeight: TILE_H + TILE_GAP}}>
					{/* Time cell */}
					<div className="flex items-center justify-end pr-2">
						<span className="text-[10px] text-gray-600 font-mono tabular-nums">
							{formatTime(event.timestamp)}
						</span>
					</div>

					{/* Agent cells */}
					{agentColumns.map((col, ci) => {
						if (ci !== colIdx) {
							return <div key={col.id} className="border-l border-gray-800/30" style={{minHeight: TILE_H}} />
						}

						return (
							<button
								key={col.id}
								type="button"
								onClick={() => toggleExpand(event.id)}
								className={`group relative flex items-center gap-2 px-2 rounded transition-all duration-150 border-l-2 cursor-pointer ${tileBg(event.type)} ${
									isExpanded
										? "ring-1 ring-white/20 bg-gray-800/80"
										: "hover:bg-gray-800/50 hover:ring-1 hover:ring-white/10"
								}`}
								style={{minHeight: TILE_H, borderLeftColor: agentColor}}
							>
								<span
									className={`text-[10px] font-bold w-4 h-4 flex items-center justify-center rounded-sm ${getEventTypeBadgeClass(event.type)}`}
								>
									{typeGlyph(event.type)}
								</span>
								<span className="text-xs text-gray-400 truncate flex-1 text-left">
									{getEventSummary(event)}
								</span>
								<span className="text-[9px] text-gray-700 font-mono tabular-nums opacity-0 group-hover:opacity-100 transition-opacity">
									{rowIdx + 1}
								</span>
							</button>
						)
					})}
				</div>

				{/* Expanded detail panel */}
				{isExpanded && (
					<div
						ref={expandedRef}
						className="mx-16 my-1 bg-gray-900 border border-gray-700/60 rounded-lg overflow-hidden animate-[slideDown_150ms_ease-out]"
					>
						<ExpandedDetailHeader event={event} agents={agents} onClose={() => setExpandedId(null)} />
						<div className="p-4 max-h-[500px] overflow-y-auto">
							<MatrixEventContent event={event} />
						</div>
					</div>
				)}
			</div>
		)
	}

	/** Render a paired tool-use + tool-result as a single row */
	function renderToolPairRow(pair: MatrixRow & {kind: "tool-pair"}, rowIdx: number) {
		const {useEvent, resultEvent, agentId} = pair
		const colIdx = agentColumns.findIndex((c) => c.id === agentId)
		const pairId = `tp-${useEvent.id}`
		const isExpanded = expandedId === pairId
		const agentColor = getAgentColor(agents, useEvent.agentId)
		const isError = resultEvent.data.type === "tool-result" && !resultEvent.data.success
		const toolName = useEvent.data.type === "tool-use" ? useEvent.data.toolName : "Tool"
		const toolDescription = useEvent.data.type === "tool-use" ? useEvent.data.description : undefined

		return (
			<div key={pairId}>
				<div className="grid gap-px" style={{gridTemplateColumns, minHeight: TILE_H + TILE_GAP}}>
					{/* Time cell */}
					<div className="flex items-center justify-end pr-2">
						<span className="text-[10px] text-gray-600 font-mono tabular-nums">
							{formatTime(useEvent.timestamp)}
						</span>
					</div>

					{/* Agent cells */}
					{agentColumns.map((col, ci) => {
						if (ci !== colIdx) {
							return <div key={col.id} className="border-l border-gray-800/30" style={{minHeight: TILE_H}} />
						}

						return (
							<button
								key={col.id}
								type="button"
								onClick={() => toggleExpand(pairId)}
								className={`group relative flex items-center gap-2 px-2 rounded transition-all duration-150 cursor-pointer ${
									isError ? "border-l-2 border-l-red-500" : "border-l-2"
								} ${
									isExpanded
										? "ring-1 ring-white/20 bg-gray-800/80"
										: "hover:bg-gray-800/50 hover:ring-1 hover:ring-white/10"
								} ${isError ? "bg-red-950/30" : "bg-blue-950/40"}`}
								style={{
									minHeight: TILE_H,
									...(isError ? {} : {borderLeftColor: agentColor}),
								}}
							>
								{/* Combined glyph: tool icon */}
								<span
									className={`text-[10px] font-bold w-4 h-4 flex items-center justify-center rounded-sm ${
										isError ? "bg-red-900 text-red-200" : "bg-blue-900 text-blue-200"
									}`}
								>
									F
								</span>
								{/* Tool name and description */}
								<span className="text-xs text-blue-300 font-mono font-medium shrink-0">{toolName}</span>
								{toolDescription && (
									<span className="text-xs text-gray-500 truncate flex-1 text-left">{toolDescription}</span>
								)}
								{!toolDescription && <span className="flex-1" />}
								{/* Status indicator */}
								{isError ? (
									<span className="text-[10px] font-semibold text-red-400 shrink-0">ERR</span>
								) : (
									<span className="text-[10px] text-emerald-600 shrink-0">OK</span>
								)}
								<span className="text-[9px] text-gray-700 font-mono tabular-nums opacity-0 group-hover:opacity-100 transition-opacity">
									{rowIdx + 1}
								</span>
							</button>
						)
					})}
				</div>

				{/* Expanded detail panel showing both input and output */}
				{isExpanded && (
					<div
						ref={expandedRef}
						className={`mx-16 my-1 bg-gray-900 border rounded-lg overflow-hidden animate-[slideDown_150ms_ease-out] ${
							isError ? "border-red-800/60" : "border-gray-700/60"
						}`}
					>
						<div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800">
							<span
								className={`text-xs px-2 py-0.5 rounded font-medium ${getEventTypeBadgeClass("tool-use")}`}
							>
								tool-use
							</span>
							<span className="text-xs text-blue-300 font-mono font-semibold">{toolName}</span>
							{isError && (
								<span className="text-xs px-2 py-0.5 rounded font-medium bg-red-900 text-red-200">
									failed
								</span>
							)}
							<span className="text-xs text-gray-500 font-mono">{formatTime(useEvent.timestamp)}</span>
							<span className="text-xs" style={{color: agentColor}}>
								{agents.find((a) => a.id === useEvent.agentId)?.name ||
									useEvent.agentId?.slice(0, 8) ||
									"main"}
							</span>
							<div className="flex-1" />
							<button
								type="button"
								onClick={() => setExpandedId(null)}
								className="text-gray-600 hover:text-gray-300 text-xs transition-colors"
							>
								ESC to close
							</button>
						</div>
						<div className="p-4 max-h-[500px] overflow-y-auto space-y-4">
							{/* Tool input */}
							<div>
								<div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2 font-semibold">
									Input
								</div>
								<MatrixEventContent event={useEvent} />
							</div>
							{/* Tool output */}
							<div>
								<div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2 font-semibold">
									Result
								</div>
								<MatrixEventContent event={resultEvent} />
							</div>
						</div>
					</div>
				)}
			</div>
		)
	}

	/** Render a collapsible sub-agent group */
	function renderAgentGroup(group: MatrixRow & {kind: "agent-group"}, rowIdx: number) {
		const isOpen = expandedAgents.has(group.agentId)
		const agentColor = getAgentColor(agents, group.agentId)
		const eventCount = group.events.length
		const description = group.agent.description || group.agent.name || group.agentId.slice(0, 12)
		const errorCount = group.events.filter((e) => e.data.type === "tool-result" && !e.data.success).length

		return (
			<div key={`ag-${group.agentId}`}>
				{/* Collapsed header row */}
				<div className="grid gap-px" style={{gridTemplateColumns, minHeight: TILE_H + TILE_GAP}}>
					{/* Time cell */}
					<div className="flex items-center justify-end pr-2">
						<span className="text-[10px] text-gray-600 font-mono tabular-nums">
							{formatTime(group.events[0]?.timestamp)}
						</span>
					</div>

					{/* Span the full agent area as a single collapsible banner */}
					<button
						type="button"
						onClick={() => toggleAgent(group.agentId)}
						className={`col-span-full flex items-center gap-3 px-3 rounded transition-all duration-150 cursor-pointer border-l-2 ${
							isOpen
								? "bg-gray-800/60 ring-1 ring-white/10"
								: "bg-gray-850/40 hover:bg-gray-800/40 hover:ring-1 hover:ring-white/10"
						}`}
						style={{minHeight: TILE_H, borderLeftColor: agentColor, gridColumn: `2 / -1`}}
					>
						{/* Chevron */}
						<span
							className={`text-gray-500 text-xs transition-transform duration-150 ${isOpen ? "rotate-90" : ""}`}
						>
							&#9654;
						</span>
						{/* Agent name */}
						<span className="text-xs font-semibold" style={{color: agentColor}}>
							{group.agent.name || group.agentId.slice(0, 8)}
						</span>
						{/* Description */}
						<span className="text-xs text-gray-500 truncate flex-1 text-left">{description}</span>
						{/* Event count badge */}
						<span className="text-[10px] text-gray-500 font-mono tabular-nums shrink-0">
							{eventCount} event{eventCount !== 1 ? "s" : ""}
						</span>
						{/* Error indicator */}
						{errorCount > 0 && (
							<span className="text-[10px] font-semibold text-red-400 shrink-0">{errorCount} err</span>
						)}
					</button>
				</div>

				{/* Expanded sub-agent events */}
				{isOpen && (
					<div
						className="border-l-2 ml-[64px] pl-0 animate-[slideDown_150ms_ease-out]"
						style={{borderLeftColor: `${agentColor}33`}}
					>
						{group.rows.map((subRow, subIdx) => renderRow(subRow, rowIdx + subIdx + 1))}
					</div>
				)}
			</div>
		)
	}

	/** Render any matrix row by dispatching on kind */
	function renderRow(row: MatrixRow, rowIdx: number): React.ReactNode {
		switch (row.kind) {
			case "event":
				return renderEventRow(row.event, row.agentId, rowIdx)
			case "tool-pair":
				return renderToolPairRow(row, rowIdx)
			case "agent-group":
				return renderAgentGroup(row, rowIdx)
		}
	}

	return (
		<div>
			{/* Sticky filter bar */}
			<div className="sticky top-0 z-40 bg-gray-950/95 backdrop-blur-sm border-b border-gray-800 pb-3 mb-4">
				<SharedFilters agents={agents} filters={filters} onFilterChange={onFilterChange} className="flex-1" />
			</div>

			{/* Column headers -- agent labels */}
			<div
				className="grid gap-px mb-1 sticky top-[52px] z-30 bg-gray-950/95 backdrop-blur-sm pb-2"
				style={{gridTemplateColumns}}
			>
				{/* Time header */}
				<div className="text-[10px] uppercase tracking-widest text-gray-600 font-mono px-2 py-2">Time</div>
				{agentColumns.map((col) => (
					<div
						key={col.id}
						className="px-2 py-2 text-xs font-semibold truncate border-b-2"
						style={{color: col.color, borderBottomColor: col.color}}
					>
						{col.name}
					</div>
				))}
			</div>

			{/* Grid body */}
			<div className="relative">
				{matrixRows.map((row, idx) => (
					<div key={rowKey(row)}>{renderRow(row, idx)}</div>
				))}
			</div>

			{events.length === 0 && (
				<div className="text-center py-16 text-gray-600">
					<div className="text-lg mb-2">No events match filters</div>
					<div className="text-sm">Adjust filters above to see session events in the matrix grid</div>
				</div>
			)}
		</div>
	)
}

function ExpandedDetailHeader({
	event,
	agents,
	onClose,
}: {
	event: Event
	agents: AgentNode[]
	onClose: () => void
}) {
	const agentColor = getAgentColor(agents, event.agentId)
	return (
		<div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800">
			<span className={`text-xs px-2 py-0.5 rounded font-medium ${getEventTypeBadgeClass(event.type)}`}>
				{event.type}
			</span>
			<span className="text-xs text-gray-500 font-mono">{formatTime(event.timestamp)}</span>
			<span className="text-xs" style={{color: agentColor}}>
				{agents.find((a) => a.id === event.agentId)?.name || event.agentId?.slice(0, 8) || "main"}
			</span>
			<div className="flex-1" />
			<button
				type="button"
				onClick={onClose}
				className="text-gray-600 hover:text-gray-300 text-xs transition-colors"
			>
				ESC to close
			</button>
		</div>
	)
}

function MatrixEventContent({event}: {event: Event}) {
	const {data} = event

	switch (data.type) {
		case "user-message":
			return (
				<div className="bg-gray-800/50 p-4 rounded border border-gray-700/50">
					<MarkdownContent>{data.text}</MarkdownContent>
				</div>
			)
		case "assistant-message":
			return (
				<div className="bg-gray-800/50 p-4 rounded border border-gray-700/50">
					<MarkdownContent>{data.text}</MarkdownContent>
				</div>
			)
		case "thinking":
			return (
				<div className="bg-gray-800/50 p-4 rounded border border-gray-700/50">
					<div className="text-xs text-purple-400 mb-2 font-medium uppercase tracking-wider">Thinking</div>
					<MarkdownContent className="text-gray-400">{data.content}</MarkdownContent>
				</div>
			)
		case "tool-use":
			return (
				<div className="space-y-3">
					<div className="flex items-center gap-3 text-sm">
						<span className="text-gray-500">Tool:</span>
						<span className="text-blue-400 font-semibold font-mono">{data.toolName}</span>
						{data.description && <span className="text-gray-400">-- {data.description}</span>}
					</div>
					<pre className="text-xs text-gray-300 whitespace-pre-wrap bg-gray-800/50 p-4 rounded border border-gray-700/50 overflow-x-auto">
						{JSON.stringify(data.input, null, 2)}
					</pre>
				</div>
			)
		case "tool-result":
			return (
				<div className="space-y-3">
					<div className="flex items-center gap-3 text-sm">
						<span className={data.success ? "text-green-400 font-medium" : "text-red-400 font-medium"}>
							{data.success ? "Success" : "Error"}
						</span>
						<span className="text-gray-500 font-mono">{data.output.length} chars</span>
					</div>
					<pre className="text-xs text-gray-300 whitespace-pre-wrap bg-gray-800/50 p-4 rounded border border-gray-700/50 overflow-x-auto max-h-96 overflow-y-auto">
						{data.output}
					</pre>
				</div>
			)
		case "agent-spawn":
			return (
				<div className="space-y-3">
					<div className="flex items-center gap-3 text-sm">
						<span className="text-gray-500">Agent:</span>
						<span className="text-amber-400 font-mono">{data.agentId}</span>
						{data.model && <span className="text-gray-500">({data.model})</span>}
					</div>
					{data.description && <div className="text-sm text-gray-400">{data.description}</div>}
					<div className="bg-gray-800/50 p-4 rounded border border-gray-700/50">
						<MarkdownContent>{data.prompt}</MarkdownContent>
					</div>
				</div>
			)
		case "summary":
			return (
				<div className="text-sm text-gray-300 bg-gray-800/50 p-4 rounded border border-gray-700/50">
					{data.summary}
				</div>
			)
		default:
			return (
				<pre className="text-xs text-gray-500 whitespace-pre-wrap bg-gray-800/50 p-4 rounded border border-gray-700/50">
					{JSON.stringify(data, null, 2)}
				</pre>
			)
	}
}
