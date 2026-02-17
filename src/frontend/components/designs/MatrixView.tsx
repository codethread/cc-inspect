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

export function MatrixView({agents, events, filters, onFilterChange}: MatrixViewProps) {
	const [expandedId, setExpandedId] = useState<string | null>(null)
	const expandedRef = useRef<HTMLDivElement | null>(null)

	// Build the column structure: one column per agent
	const agentColumns = useMemo(() => {
		if (agents.length === 0) return []
		return agents.map((agent) => ({
			id: agent.id,
			name: agent.name || agent.id.slice(0, 8),
			color: getAgentColor(agents, agent.id),
		}))
	}, [agents])

	// Group events into rows by assigning each event to its agent column
	// Each "row" represents a time slice; consecutive events on the same agent share a row
	const gridRows = useMemo(() => {
		const rows: {time: Date; cells: Map<string, Event>}[] = []
		for (const event of events) {
			const agentId = event.agentId ?? agents[0]?.id ?? ""
			// Each event gets its own row for simplicity and chronological clarity
			const cellMap = new Map<string, Event>()
			cellMap.set(agentId, event)
			rows.push({time: event.timestamp, cells: cellMap})
		}
		return rows
	}, [events, agents])

	const toggleExpand = useCallback((id: string) => {
		setExpandedId((prev) => (prev === id ? null : id))
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

	return (
		<div>
			{/* Sticky filter bar */}
			<div className="sticky top-0 z-40 bg-gray-950/95 backdrop-blur-sm border-b border-gray-800 pb-3 mb-4">
				<SharedFilters agents={agents} filters={filters} onFilterChange={onFilterChange} className="flex-1" />
			</div>

			{/* Column headers -- agent labels */}
			<div
				className="grid gap-px mb-1 sticky top-[52px] z-30 bg-gray-950/95 backdrop-blur-sm pb-2"
				style={{
					gridTemplateColumns: `64px repeat(${colCount}, minmax(120px, 1fr))`,
				}}
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
				{gridRows.map((row, rowIdx) => {
					// Find the event in this row (there is exactly one per row in our layout)
					const entries = [...row.cells.entries()]
					const firstEntry = entries[0]
					if (!firstEntry) return null
					const [activeAgentId, event] = firstEntry
					const colIdx = agentColumns.findIndex((c) => c.id === activeAgentId)
					const isExpanded = expandedId === event.id
					const agentColor = getAgentColor(agents, event.agentId)

					return (
						<div key={event.id}>
							{/* The grid row */}
							<div
								className="grid gap-px"
								style={{
									gridTemplateColumns: `64px repeat(${colCount}, minmax(120px, 1fr))`,
									minHeight: TILE_H + TILE_GAP,
								}}
							>
								{/* Time cell */}
								<div className="flex items-center justify-end pr-2">
									<span className="text-[10px] text-gray-600 font-mono tabular-nums">
										{formatTime(row.time)}
									</span>
								</div>

								{/* Agent cells -- empty except the active one */}
								{agentColumns.map((col, ci) => {
									if (ci !== colIdx) {
										// Empty cell -- just a faint grid line
										return (
											<div key={col.id} className="border-l border-gray-800/30" style={{minHeight: TILE_H}} />
										)
									}

									// Active cell -- the event tile
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
											style={{
												minHeight: TILE_H,
												borderLeftColor: agentColor,
											}}
										>
											{/* Glyph */}
											<span
												className={`text-[10px] font-bold w-4 h-4 flex items-center justify-center rounded-sm ${getEventTypeBadgeClass(event.type)}`}
											>
												{typeGlyph(event.type)}
											</span>

											{/* Summary text */}
											<span className="text-xs text-gray-400 truncate flex-1 text-left">
												{getEventSummary(event)}
											</span>

											{/* Row number */}
											<span className="text-[9px] text-gray-700 font-mono tabular-nums opacity-0 group-hover:opacity-100 transition-opacity">
												{rowIdx + 1}
											</span>
										</button>
									)
								})}
							</div>

							{/* Expanded detail panel -- slides down under the row */}
							{isExpanded && (
								<div
									ref={expandedRef}
									className="mx-16 my-1 bg-gray-900 border border-gray-700/60 rounded-lg overflow-hidden animate-[slideDown_150ms_ease-out]"
								>
									{/* Detail header */}
									<div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800">
										<span
											className={`text-xs px-2 py-0.5 rounded font-medium ${getEventTypeBadgeClass(event.type)}`}
										>
											{event.type}
										</span>
										<span className="text-xs text-gray-500 font-mono">{formatTime(event.timestamp)}</span>
										<span className="text-xs" style={{color: agentColor}}>
											{agents.find((a) => a.id === event.agentId)?.name ||
												event.agentId?.slice(0, 8) ||
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

									{/* Detail body */}
									<div className="p-4 max-h-[500px] overflow-y-auto">
										<MatrixEventContent event={event} />
									</div>
								</div>
							)}
						</div>
					)
				})}
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
