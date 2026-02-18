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

const BLOCK_HEIGHT = 36
const LANE_HEIGHT = 52
const LANE_LABEL_WIDTH = 140
const MIN_BLOCK_WIDTH = 80
const SPAN_BLOCK_WIDTH = 160
const MIN_GAP = 6
const TIMELINE_PADDING = 40

const TYPE_COLORS: Record<string, string> = {
	"user-message": "#164e63",
	"assistant-message": "#581c87",
	thinking: "#4a1d96",
	"tool-use": "#1e3a5f",
	"tool-result": "#14532d",
	"agent-spawn": "#713f12",
	summary: "#374151",
}

/** A visual block in the swimlane -- either a single event or a tool-use+tool-result span */
interface SwimBlock {
	id: string
	type: "single" | "span"
	toolUse: Event
	toolResult: Event | null
	/** Whether the tool result was an error */
	failed: boolean
	/** Timestamp used for positioning (earliest of the pair) */
	timestamp: number
	/** Computed X position (left edge) */
	x: number
	/** Computed width */
	width: number
}

function buildSwimBlocks(laneEvents: Event[], allToolResultMap: Map<string, Event>): SwimBlock[] {
	const blocks: SwimBlock[] = []
	const consumedResultIds = new Set<string>()

	for (const event of laneEvents) {
		if (event.data.type === "tool-use") {
			const toolId = event.data.toolId
			const result = allToolResultMap.get(toolId)
			if (result) {
				consumedResultIds.add(result.id)
				const failed = result.data.type === "tool-result" && !result.data.success
				blocks.push({
					id: event.id,
					type: "span",
					toolUse: event,
					toolResult: result,
					failed,
					timestamp: event.timestamp.getTime(),
					x: 0,
					width: SPAN_BLOCK_WIDTH,
				})
			} else {
				blocks.push({
					id: event.id,
					type: "single",
					toolUse: event,
					toolResult: null,
					failed: false,
					timestamp: event.timestamp.getTime(),
					x: 0,
					width: MIN_BLOCK_WIDTH,
				})
			}
		} else if (event.data.type === "tool-result") {
			// Skip if already consumed into a span
			if (consumedResultIds.has(event.id)) continue
			blocks.push({
				id: event.id,
				type: "single",
				toolUse: event,
				toolResult: null,
				failed: event.data.type === "tool-result" && !event.data.success,
				timestamp: event.timestamp.getTime(),
				x: 0,
				width: MIN_BLOCK_WIDTH,
			})
		} else {
			blocks.push({
				id: event.id,
				type: "single",
				toolUse: event,
				toolResult: null,
				failed: false,
				timestamp: event.timestamp.getTime(),
				x: 0,
				width: MIN_BLOCK_WIDTH,
			})
		}
	}

	return blocks
}

interface TimeRange {
	min: number
	max: number
	availableWidth: number
}

/** Compute time-proportional X positions for blocks, enforcing a minimum gap */
function layoutBlocks(blocks: SwimBlock[], range: TimeRange): void {
	if (blocks.length === 0) return
	const span = range.max - range.min

	for (const block of blocks) {
		if (span === 0) {
			block.x = LANE_LABEL_WIDTH
		} else {
			const ratio = (block.timestamp - range.min) / span
			block.x = LANE_LABEL_WIDTH + ratio * range.availableWidth
		}
	}

	// Enforce minimum gap so blocks don't overlap: sweep left-to-right and push right
	for (let i = 1; i < blocks.length; i++) {
		const prev = blocks[i - 1]
		const curr = blocks[i]
		if (!prev || !curr) continue
		const minLeft = prev.x + prev.width + MIN_GAP
		if (curr.x < minLeft) {
			curr.x = minLeft
		}
	}
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

	// Build a map of toolId -> tool-result event for pairing
	const toolResultMap = useMemo(() => {
		const map = new Map<string, Event>()
		for (const event of events) {
			if (event.data.type === "tool-result") {
				map.set(event.data.toolUseId, event)
			}
		}
		return map
	}, [events])

	// Global time range across all events
	const {minTime, maxTime} = useMemo(() => {
		if (events.length === 0) return {minTime: 0, maxTime: 0}
		let min = Number.POSITIVE_INFINITY
		let max = Number.NEGATIVE_INFINITY
		for (const e of events) {
			const t = e.timestamp.getTime()
			if (t < min) min = t
			if (t > max) max = t
		}
		return {minTime: min, maxTime: max}
	}, [events])

	// Build swimlane data with time-positioned blocks
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

	// Build blocks and compute layout
	const {laneBlocks, totalWidth} = useMemo(() => {
		// Generous available width that scales with event density
		const baseAvailableWidth = Math.max(800, events.length * 30)
		const range: TimeRange = {min: minTime, max: maxTime, availableWidth: baseAvailableWidth}

		const allLaneBlocks: {agent: AgentNode; blocks: SwimBlock[]}[] = []

		for (const lane of swimlaneData) {
			const blocks = buildSwimBlocks(lane.events, toolResultMap)
			layoutBlocks(blocks, range)
			allLaneBlocks.push({agent: lane.agent, blocks})
		}

		// Compute the overall width needed: rightmost edge of any block + padding
		let maxRight = LANE_LABEL_WIDTH + baseAvailableWidth
		for (const lane of allLaneBlocks) {
			for (const block of lane.blocks) {
				const right = block.x + block.width
				if (right > maxRight) maxRight = right
			}
		}

		return {laneBlocks: allLaneBlocks, totalWidth: maxRight + TIMELINE_PADDING}
	}, [swimlaneData, toolResultMap, minTime, maxTime, events.length])

	const totalHeight = laneBlocks.length * LANE_HEIGHT

	// Build spawn connections between lanes using block positions
	const connections = useMemo(() => {
		const conns: {fromLane: number; fromX: number; toLane: number; toX: number; type: string}[] = []

		for (const event of events) {
			if (event.data.type !== "tool-use" || event.data.toolName !== "Task") continue

			const toolId = event.data.toolId
			const result = events.find(
				(e) => e.data.type === "tool-result" && e.data.toolUseId === toolId && e.data.agentId,
			)
			if (!result || result.data.type !== "tool-result" || !result.data.agentId) continue

			const spawnedAgentId = result.data.agentId
			const parentLaneIdx = laneBlocks.findIndex((l) => l.agent.id === event.agentId)
			const childLaneIdx = laneBlocks.findIndex((l) => l.agent.id === spawnedAgentId)
			if (parentLaneIdx === -1 || childLaneIdx === -1) continue

			const parentLane = laneBlocks[parentLaneIdx]
			const childLane = laneBlocks[childLaneIdx]
			if (!parentLane || !childLane) continue

			// Find the block containing this tool-use event
			const parentBlock = parentLane.blocks.find((b) => b.toolUse.id === event.id)
			const childFirstBlock = childLane.blocks[0]

			if (parentBlock && childFirstBlock) {
				conns.push({
					fromLane: parentLaneIdx,
					fromX: parentBlock.x + parentBlock.width / 2,
					toLane: childLaneIdx,
					toX: childFirstBlock.x + childFirstBlock.width / 2,
					type: "spawn",
				})
			}
		}

		return conns
	}, [events, laneBlocks])

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
						{laneBlocks.map((lane, laneIdx) =>
							lane.blocks.map((block) => (
								<rect
									key={block.id}
									x={block.x}
									y={laneIdx * LANE_HEIGHT + 4}
									width={block.width}
									height={LANE_HEIGHT - 8}
									fill={TYPE_COLORS[block.toolUse.type] || "#374151"}
									rx={2}
									stroke={block.failed ? "#ef4444" : "none"}
									strokeWidth={block.failed ? 2 : 0}
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
					{laneBlocks.map((lane, laneIdx) => {
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
								{lane.blocks.map((block) => {
									const isSpan = block.type === "span"
									const primaryEvent = block.toolUse
									const isSelected =
										selectedEvent?.id === primaryEvent.id ||
										(block.toolResult && selectedEvent?.id === block.toolResult.id)
									const bgColor = TYPE_COLORS[primaryEvent.type] || "#374151"

									return (
										<button
											key={block.id}
											type="button"
											onClick={() => onSelectEvent(isSelected ? null : primaryEvent)}
											className={`absolute rounded text-xs px-2 py-1 truncate text-left transition-all ${
												isSelected ? "ring-2 ring-blue-400 z-20" : "hover:brightness-125"
											} ${block.failed ? "ring-1 ring-red-500/70" : ""}`}
											style={{
												left: block.x,
												top: (LANE_HEIGHT - BLOCK_HEIGHT) / 2,
												width: block.width,
												height: BLOCK_HEIGHT,
												backgroundColor: bgColor,
												// Spans get a subtle gradient to show the two phases
												...(isSpan
													? {
															background: `linear-gradient(90deg, ${bgColor} 55%, ${block.failed ? "#7f1d1d" : "#14532d"} 100%)`,
															borderLeft: `2px solid ${bgColor}`,
															borderRight: `2px solid ${block.failed ? "#ef4444" : "#22c55e"}`,
														}
													: {}),
											}}
											title={
												isSpan && block.toolResult
													? `${getEventSummary(primaryEvent)} → ${getEventSummary(block.toolResult)}`
													: getEventSummary(primaryEvent)
											}
										>
											{isSpan ? (
												<>
													<div className="text-[10px] text-gray-400 flex items-center gap-1">
														<span>tool-use</span>
														<span className="text-gray-600">→</span>
														<span className={block.failed ? "text-red-400" : "text-green-400"}>
															{block.failed ? "err" : "ok"}
														</span>
													</div>
													<div className="text-gray-200 truncate text-[11px]">
														{getShortLabel(primaryEvent)}
													</div>
												</>
											) : (
												<>
													<div className="text-[10px] text-gray-400">{primaryEvent.type}</div>
													<div className="text-gray-200 truncate text-[11px]">
														{getShortLabel(primaryEvent)}
													</div>
												</>
											)}
										</button>
									)
								})}

								{/* Lane separator */}
								{laneIdx < laneBlocks.length - 1 && (
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
