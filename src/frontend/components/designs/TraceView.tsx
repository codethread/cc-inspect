import {useEffect, useMemo, useRef} from "react"
import type {AgentNode, Event} from "#types"
import {MarkdownContent} from "../MarkdownContent"
import {SharedFilters} from "../SharedFilters"
import {type FilterState, formatTime, getAgentColor, getEventSummary, getEventTypeBadgeClass} from "../shared"

interface TraceViewProps {
	agents: AgentNode[]
	events: Event[]
	filters: FilterState
	onFilterChange: (f: FilterState) => void
	selectedEvent: Event | null
	onSelectEvent: (e: Event | null) => void
}

const BLOCK_WIDTH = 120
const BLOCK_HEIGHT = 36
const BLOCK_GAP = 4
const LANE_HEIGHT = 52
const LANE_LABEL_WIDTH = 140

const TYPE_COLORS: Record<string, string> = {
	"user-message": "#164e63",
	"assistant-message": "#581c87",
	thinking: "#4a1d96",
	"tool-use": "#1e3a5f",
	"tool-result": "#14532d",
	"agent-spawn": "#713f12",
	summary: "#374151",
}

export function TraceView({
	agents,
	events,
	filters,
	onFilterChange,
	selectedEvent,
	onSelectEvent,
}: TraceViewProps) {
	const scrollRef = useRef<HTMLDivElement>(null)

	// Build swimlane data: for each agent, place events in sequence order
	const swimlaneData = useMemo(() => {
		const agentLanes = new Map<string, {agent: AgentNode; events: Event[]}>()

		for (const agent of agents) {
			agentLanes.set(agent.id, {agent, events: []})
		}

		for (const event of events) {
			const agentId = event.agentId || agents[0]?.id
			if (agentId) {
				const lane = agentLanes.get(agentId)
				if (lane) {
					lane.events.push(event)
				}
			}
		}

		return Array.from(agentLanes.values()).filter((lane) => lane.events.length > 0)
	}, [agents, events])

	// Build spawn connections between lanes
	const connections = useMemo(() => {
		const conns: {fromLane: number; fromX: number; toLane: number; toX: number; type: string}[] = []

		for (const event of events) {
			if (event.data.type !== "tool-use" || event.data.toolName !== "Task") continue

			const toolId = event.data.toolId
			// Find the matching tool-result with agentId
			const result = events.find(
				(e) => e.data.type === "tool-result" && e.data.toolUseId === toolId && e.data.agentId,
			)
			if (!result || result.data.type !== "tool-result" || !result.data.agentId) continue

			const spawnedAgentId = result.data.agentId
			const parentLaneIdx = swimlaneData.findIndex((l) => l.agent.id === event.agentId)
			const childLaneIdx = swimlaneData.findIndex((l) => l.agent.id === spawnedAgentId)
			if (parentLaneIdx === -1 || childLaneIdx === -1) continue

			const parentLane = swimlaneData[parentLaneIdx]
			const childLane = swimlaneData[childLaneIdx]
			if (!parentLane || !childLane) continue

			const parentEventIdx = parentLane.events.findIndex((e) => e.id === event.id)
			const childFirstIdx = 0

			if (parentEventIdx >= 0 && childLane.events.length > 0) {
				conns.push({
					fromLane: parentLaneIdx,
					fromX: LANE_LABEL_WIDTH + parentEventIdx * (BLOCK_WIDTH + BLOCK_GAP) + BLOCK_WIDTH / 2,
					toLane: childLaneIdx,
					toX: LANE_LABEL_WIDTH + childFirstIdx * (BLOCK_WIDTH + BLOCK_GAP) + BLOCK_WIDTH / 2,
					type: "spawn",
				})
			}
		}

		return conns
	}, [events, swimlaneData])

	const maxEventsInLane = Math.max(1, ...swimlaneData.map((l) => l.events.length))
	const totalWidth = LANE_LABEL_WIDTH + maxEventsInLane * (BLOCK_WIDTH + BLOCK_GAP) + 40
	const totalHeight = swimlaneData.length * LANE_HEIGHT

	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape" && selectedEvent) {
				onSelectEvent(null)
			}
		}
		window.addEventListener("keydown", handler)
		return () => window.removeEventListener("keydown", handler)
	}, [selectedEvent, onSelectEvent])

	return (
		<div>
			{/* Filter bar */}
			<div className="mb-4">
				<SharedFilters agents={agents} filters={filters} onFilterChange={onFilterChange} />
			</div>

			{/* Minimap */}
			<div className="mb-3 bg-gray-900 border border-gray-800 rounded p-2 overflow-hidden">
				<div className="h-8 overflow-hidden">
					<svg
						width="100%"
						height={32}
						viewBox={`0 0 ${totalWidth} ${totalHeight}`}
						preserveAspectRatio="none"
						role="img"
						aria-label="Event minimap overview"
					>
						{swimlaneData.map((lane, laneIdx) =>
							lane.events.map((event, eventIdx) => (
								<rect
									key={event.id}
									x={LANE_LABEL_WIDTH + eventIdx * (BLOCK_WIDTH + BLOCK_GAP)}
									y={laneIdx * LANE_HEIGHT + 4}
									width={BLOCK_WIDTH}
									height={LANE_HEIGHT - 8}
									fill={TYPE_COLORS[event.type] || "#374151"}
									rx={2}
								/>
							)),
						)}
					</svg>
				</div>
			</div>

			{/* Main swimlane area */}
			<div ref={scrollRef} className="overflow-x-auto bg-gray-900 border border-gray-800 rounded-lg">
				<div style={{width: totalWidth, minHeight: totalHeight}} className="relative">
					{/* SVG connections */}
					<svg
						className="absolute inset-0 pointer-events-none"
						width={totalWidth}
						height={totalHeight}
						role="img"
						aria-label="Agent connections"
					>
						{connections.map((conn) => {
							const y1 = conn.fromLane * LANE_HEIGHT + LANE_HEIGHT / 2
							const y2 = conn.toLane * LANE_HEIGHT + LANE_HEIGHT / 2
							return (
								<path
									key={`conn-${conn.fromLane}-${conn.toLane}-${conn.fromX}-${conn.toX}`}
									d={`M ${conn.fromX} ${y1} C ${conn.fromX + 30} ${y1}, ${conn.toX - 30} ${y2}, ${conn.toX} ${y2}`}
									stroke="rgba(59, 130, 246, 0.4)"
									strokeWidth={1.5}
									fill="none"
									strokeDasharray="4 4"
								/>
							)
						})}
					</svg>

					{/* Lanes */}
					{swimlaneData.map((lane, laneIdx) => {
						const color = getAgentColor(agents, lane.agent.id)
						return (
							<div
								key={lane.agent.id}
								className="absolute flex items-center"
								style={{
									top: laneIdx * LANE_HEIGHT,
									height: LANE_HEIGHT,
									width: totalWidth,
								}}
							>
								{/* Sticky lane label */}
								<div
									className="sticky left-0 z-10 bg-gray-900 border-r border-gray-800 px-3 flex items-center gap-2 h-full"
									style={{width: LANE_LABEL_WIDTH}}
								>
									<div className="w-2 h-2 rounded-full flex-shrink-0" style={{backgroundColor: color}} />
									<div className="text-xs text-gray-400 truncate">
										{lane.agent.name || lane.agent.id.slice(0, 12)}
									</div>
								</div>

								{/* Event blocks */}
								{lane.events.map((event, eventIdx) => {
									const isSelected = selectedEvent?.id === event.id
									const bgColor = TYPE_COLORS[event.type] || "#374151"
									return (
										<button
											key={event.id}
											type="button"
											onClick={() => onSelectEvent(isSelected ? null : event)}
											className={`absolute rounded text-xs px-2 py-1 truncate text-left transition-all ${
												isSelected ? "ring-2 ring-blue-400 z-20" : "hover:brightness-125"
											}`}
											style={{
												left: LANE_LABEL_WIDTH + eventIdx * (BLOCK_WIDTH + BLOCK_GAP),
												top: (LANE_HEIGHT - BLOCK_HEIGHT) / 2,
												width: BLOCK_WIDTH,
												height: BLOCK_HEIGHT,
												backgroundColor: bgColor,
											}}
											title={getEventSummary(event)}
										>
											<div className="text-[10px] text-gray-400">{event.type}</div>
											<div className="text-gray-200 truncate text-[11px]">{getShortLabel(event)}</div>
										</button>
									)
								})}

								{/* Lane separator */}
								{laneIdx < swimlaneData.length - 1 && (
									<div className="absolute bottom-0 left-0 h-px bg-gray-800" style={{width: totalWidth}} />
								)}
							</div>
						)
					})}
				</div>
			</div>

			{/* Bottom detail drawer */}
			{selectedEvent && (
				<div className="mt-4 bg-gray-900 border border-gray-800 rounded-lg">
					<div className="flex items-center justify-between px-4 py-2 border-b border-gray-800">
						<div className="flex items-center gap-3">
							<span className={`text-xs px-2 py-0.5 rounded ${getEventTypeBadgeClass(selectedEvent.type)}`}>
								{selectedEvent.type}
							</span>
							<span className="text-xs text-gray-400 font-mono">{formatTime(selectedEvent.timestamp)}</span>
							<span className="text-xs text-gray-500">
								{selectedEvent.agentName || selectedEvent.agentId}
							</span>
						</div>
						<button
							type="button"
							onClick={() => onSelectEvent(null)}
							className="text-gray-500 hover:text-gray-300 text-sm"
						>
							Esc to close
						</button>
					</div>
					<div className="p-4 max-h-80 overflow-y-auto">
						<TraceEventContent event={selectedEvent} />
					</div>
				</div>
			)}

			{events.length === 0 && (
				<div className="text-center py-12 text-gray-500">No events match the current filters</div>
			)}
		</div>
	)
}

function getShortLabel(event: Event): string {
	const {data} = event
	switch (data.type) {
		case "user-message":
			return data.text.slice(0, 20)
		case "assistant-message":
			return data.text.slice(0, 20)
		case "thinking":
			return "thinking..."
		case "tool-use":
			return data.toolName
		case "tool-result":
			return data.success ? "result ok" : "result err"
		case "agent-spawn":
			return data.agentId.slice(0, 12)
		case "summary":
			return "summary"
		default:
			return "?"
	}
}

function TraceEventContent({event}: {event: Event}) {
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
					<MarkdownContent className="text-gray-400">{data.content}</MarkdownContent>
				</div>
			)
		case "tool-use":
			return (
				<div className="space-y-2">
					<div className="text-sm">
						<span className="text-blue-400 font-semibold">{data.toolName}</span>
						{data.description && <span className="text-gray-400 ml-2">{data.description}</span>}
					</div>
					<pre className="text-xs text-gray-300 whitespace-pre-wrap bg-gray-800 p-3 rounded border border-gray-700 overflow-x-auto">
						{JSON.stringify(data.input, null, 2)}
					</pre>
				</div>
			)
		case "tool-result":
			return (
				<div className="space-y-2">
					<div className={`text-sm font-medium ${data.success ? "text-green-400" : "text-red-400"}`}>
						{data.success ? "Success" : "Error"} ({data.output.length} chars)
					</div>
					<pre className="text-xs text-gray-300 whitespace-pre-wrap bg-gray-800 p-3 rounded border border-gray-700 overflow-x-auto max-h-48 overflow-y-auto">
						{data.output}
					</pre>
				</div>
			)
		case "agent-spawn":
			return (
				<div className="space-y-2">
					<div className="text-sm text-blue-400 font-mono">{data.agentId}</div>
					{data.description && <div className="text-sm text-gray-400">{data.description}</div>}
					<div className="bg-gray-800 p-3 rounded border border-gray-700">
						<MarkdownContent>{data.prompt}</MarkdownContent>
					</div>
				</div>
			)
		case "summary":
			return <div className="text-sm text-gray-300">{data.summary}</div>
		default:
			return <pre className="text-xs text-gray-500">{JSON.stringify(data, null, 2)}</pre>
	}
}
