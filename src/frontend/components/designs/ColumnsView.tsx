import {useCallback, useEffect, useMemo, useState} from "react"
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
	filters: FilterState
	onFilterChange: (f: FilterState) => void
	selectedEvent: Event | null
	onSelectEvent: (e: Event | null) => void
}

export function ColumnsView({
	agents,
	events,
	filters,
	onFilterChange,
	selectedEvent,
	onSelectEvent,
}: ColumnsViewProps) {
	const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
	const [rightPanelOpen, setRightPanelOpen] = useState(false)
	const [leftWidth, setLeftWidth] = useState(250)
	const [rightWidth, setRightWidth] = useState(500)

	// Filter events by selected agent
	const displayedEvents = useMemo(() => {
		if (!selectedAgentId) return events
		return events.filter((e) => e.agentId === selectedAgentId)
	}, [events, selectedAgentId])

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

					{/* All agents option */}
					<button
						type="button"
						onClick={() => setSelectedAgentId(null)}
						className={`w-full text-left px-2 py-1.5 rounded text-sm transition-colors mb-1 ${
							selectedAgentId === null ? "bg-blue-900/50 text-blue-200" : "text-gray-400 hover:bg-gray-800"
						}`}
					>
						All agents
						<span className="text-xs text-gray-500 ml-1">({events.length})</span>
					</button>

					{agents.map((agent) => {
						const color = getAgentColor(agents, agent.id)
						const eventCount = events.filter((e) => e.agentId === agent.id).length
						const isSelected = selectedAgentId === agent.id
						return (
							<button
								key={agent.id}
								type="button"
								onClick={() => setSelectedAgentId(agent.id)}
								className={`w-full text-left px-2 py-1.5 rounded text-sm transition-colors flex items-center gap-2 ${
									isSelected ? "bg-blue-900/50 text-blue-200" : "text-gray-400 hover:bg-gray-800"
								}`}
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
						const isActive = filters.eventTypes.has(type)
						return (
							<button
								key={type}
								type="button"
								onClick={() => toggleEventType(type)}
								className={`w-full text-left px-2 py-1 rounded text-xs transition-opacity mb-0.5 ${getEventTypeBadgeClass(type)} ${
									isActive ? "opacity-100" : "opacity-40 hover:opacity-70"
								}`}
							>
								{type}
							</button>
						)
					})}
				</div>

				{/* Resize handle */}
				<DragHandle
					direction="horizontal"
					onDrag={(delta) => setLeftWidth((w) => Math.max(180, Math.min(400, w + delta)))}
				/>
			</div>

			{/* Center panel: event stream */}
			<div className="flex-1 overflow-y-auto min-w-0">
				{displayedEvents.length === 0 ? (
					<div className="text-center py-12 text-gray-500">No events</div>
				) : (
					<div>
						{displayedEvents.map((event) => {
							const isSelected = selectedEvent?.id === event.id
							const color = getAgentColor(agents, event.agentId)
							const agent = agents.find((a) => a.id === event.agentId)

							return (
								<button
									key={event.id}
									type="button"
									onClick={() => handleSelectEvent(isSelected ? null : event)}
									className={`w-full text-left px-4 py-3 border-b border-gray-800/50 transition-colors ${
										isSelected ? "bg-blue-900/20" : "hover:bg-gray-800/50"
									}`}
								>
									<div className="flex items-center gap-3 mb-1">
										{/* Type icon dot */}
										<div className="w-2 h-2 rounded-full flex-shrink-0" style={{backgroundColor: color}} />

										{/* Agent badge */}
										<span className="text-xs font-medium truncate max-w-[100px]" style={{color}}>
											{agent?.name || event.agentId?.slice(0, 8) || "main"}
										</span>

										{/* Type badge */}
										<span className={`text-xs px-1.5 py-0.5 rounded ${getEventTypeBadgeClass(event.type)}`}>
											{event.type}
										</span>

										{/* Timestamp */}
										<span className="text-xs text-gray-600 font-mono ml-auto flex-shrink-0">
											{formatTime(event.timestamp)}
										</span>
									</div>

									{/* Summary */}
									<div className="text-sm text-gray-300 truncate pl-5">{getEventSummary(event)}</div>
								</button>
							)
						})}
					</div>
				)}
			</div>

			{/* Right panel: event details */}
			{rightPanelOpen && selectedEvent && (
				<>
					{/* Resize handle */}
					<DragHandle
						direction="horizontal"
						onDrag={(delta) => setRightWidth((w) => Math.max(300, Math.min(800, w - delta)))}
					/>

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

function DragHandle({onDrag}: {direction: "horizontal"; onDrag: (delta: number) => void}) {
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
