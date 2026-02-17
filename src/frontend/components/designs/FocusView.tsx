import {useCallback, useEffect, useMemo, useRef, useState} from "react"
import type {AgentNode, Event} from "#types"
import {MarkdownContent} from "../MarkdownContent"
import {SharedFilters} from "../SharedFilters"
import {type FilterState, formatTime, getAgentColor, getEventSummary, getEventTypeBadgeClass} from "../shared"

interface FocusViewProps {
	agents: AgentNode[]
	events: Event[]
	filters: FilterState
	onFilterChange: (f: FilterState) => void
}

/** How many context events to show above and below the focused event */
const CONTEXT_COUNT = 3

/** Opacity for context cards, decreasing as they move further from focus */
function contextOpacity(distance: number): number {
	const opacities = [0.55, 0.35, 0.2, 0.1]
	return opacities[distance] ?? 0.05
}

/** Scale for context cards, shrinking as they move from center */
function contextScale(distance: number): number {
	const scales = [0.94, 0.88, 0.82, 0.76]
	return scales[distance] ?? 0.7
}

export function FocusView({agents, events, filters, onFilterChange}: FocusViewProps) {
	const [focusIndex, setFocusIndex] = useState(0)
	const [detailOpen, setDetailOpen] = useState(false)
	const containerRef = useRef<HTMLDivElement | null>(null)
	const minimapRef = useRef<HTMLDivElement | null>(null)

	// Clamp focus index when events change
	useEffect(() => {
		if (events.length === 0) {
			setFocusIndex(0)
			return
		}
		if (focusIndex >= events.length) {
			setFocusIndex(events.length - 1)
		}
	}, [events.length, focusIndex])

	const focusedEvent = events[focusIndex] ?? null

	// Context events above and below
	const contextAbove = useMemo(() => {
		const result: {event: Event; distance: number}[] = []
		for (let d = 1; d <= CONTEXT_COUNT; d++) {
			const idx = focusIndex - d
			if (idx >= 0 && events[idx]) {
				result.unshift({event: events[idx], distance: d})
			}
		}
		return result
	}, [events, focusIndex])

	const contextBelow = useMemo(() => {
		const result: {event: Event; distance: number}[] = []
		for (let d = 1; d <= CONTEXT_COUNT; d++) {
			const idx = focusIndex + d
			if (idx < events.length && events[idx]) {
				result.push({event: events[idx], distance: d})
			}
		}
		return result
	}, [events, focusIndex])

	const navigate = useCallback(
		(direction: -1 | 1) => {
			setFocusIndex((prev) => {
				const next = prev + direction
				if (next < 0 || next >= events.length) return prev
				return next
			})
		},
		[events.length],
	)

	// Keyboard navigation: arrows to move, Enter to toggle detail, Escape to close
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
				e.preventDefault()
				navigate(-1)
			} else if (e.key === "ArrowDown" || e.key === "ArrowRight") {
				e.preventDefault()
				navigate(1)
			} else if (e.key === "Enter") {
				e.preventDefault()
				setDetailOpen((prev) => !prev)
			} else if (e.key === "Escape") {
				if (detailOpen) {
					setDetailOpen(false)
				}
			}
		}
		window.addEventListener("keydown", handler)
		return () => window.removeEventListener("keydown", handler)
	}, [navigate, detailOpen])

	// Scroll minimap indicator into view when focus changes
	const scrollMinimapToFocus = useCallback((targetIndex: number) => {
		if (minimapRef.current && targetIndex >= 0) {
			const indicator = minimapRef.current.querySelector("[data-active-minimap]")
			if (indicator) {
				indicator.scrollIntoView({behavior: "smooth", block: "nearest"})
			}
		}
	}, [])

	useEffect(() => {
		scrollMinimapToFocus(focusIndex)
	}, [focusIndex, scrollMinimapToFocus])

	const progress = events.length > 0 ? ((focusIndex + 1) / events.length) * 100 : 0

	return (
		<div>
			{/* Sticky filter bar */}
			<div className="sticky top-0 z-40 bg-gray-950/95 backdrop-blur-sm border-b border-gray-800 pb-3 mb-4">
				<SharedFilters agents={agents} filters={filters} onFilterChange={onFilterChange} className="flex-1" />
			</div>

			{events.length === 0 ? (
				<div className="text-center py-16 text-gray-600">
					<div className="text-lg mb-2">No events match filters</div>
					<div className="text-sm">Adjust filters to see session events</div>
				</div>
			) : (
				<div className="flex gap-6" ref={containerRef}>
					{/* Minimap sidebar */}
					<div className="w-16 flex-shrink-0 flex flex-col items-center">
						{/* Position indicator */}
						<div className="text-[10px] text-gray-600 font-mono mb-2 tabular-nums">
							{focusIndex + 1}/{events.length}
						</div>

						{/* Progress bar */}
						<div className="w-1.5 flex-1 bg-gray-800/50 rounded-full relative overflow-hidden max-h-[600px]">
							<div
								className="absolute top-0 left-0 w-full bg-blue-500/60 rounded-full transition-all duration-200"
								style={{height: `${progress}%`}}
							/>
						</div>

						{/* Minimap dots */}
						<div
							ref={minimapRef}
							className="mt-2 flex flex-col gap-px items-center max-h-[400px] overflow-y-auto scrollbar-thin"
						>
							{events.map((event, idx) => {
								const isFocused = idx === focusIndex
								const agentColor = getAgentColor(agents, event.agentId)
								return (
									<button
										key={event.id}
										type="button"
										onClick={() => setFocusIndex(idx)}
										className={`rounded-sm transition-all duration-100 ${
											isFocused ? "w-3 h-2" : "w-1.5 h-1 opacity-60 hover:opacity-100"
										}`}
										style={{backgroundColor: isFocused ? agentColor : `${agentColor}80`}}
										title={`${idx + 1}: ${event.type}`}
										{...(isFocused ? {"data-active-minimap": true} : {})}
									/>
								)
							})}
						</div>
					</div>

					{/* Main focus area */}
					<div className="flex-1 min-w-0">
						{/* Context cards ABOVE */}
						<div className="flex flex-col items-center gap-1 mb-3">
							{contextAbove.map(({event, distance}) => (
								<ContextCard
									key={event.id}
									event={event}
									agents={agents}
									distance={distance}
									onClick={() => setFocusIndex(focusIndex - distance)}
								/>
							))}
						</div>

						{/* Navigation hint */}
						{focusIndex > 0 && (
							<div className="flex justify-center mb-2">
								<button
									type="button"
									onClick={() => navigate(-1)}
									className="text-gray-700 hover:text-gray-400 transition-colors"
								>
									<svg
										className="w-5 h-5"
										fill="none"
										viewBox="0 0 24 24"
										stroke="currentColor"
										strokeWidth={2}
									>
										<title>Previous event</title>
										<path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
									</svg>
								</button>
							</div>
						)}

						{/* FOCUSED EVENT -- the star of the show */}
						{focusedEvent && (
							<FocusedCard
								event={focusedEvent}
								agents={agents}
								index={focusIndex}
								total={events.length}
								detailOpen={detailOpen}
								onToggleDetail={() => setDetailOpen((p) => !p)}
							/>
						)}

						{/* Navigation hint */}
						{focusIndex < events.length - 1 && (
							<div className="flex justify-center mt-2">
								<button
									type="button"
									onClick={() => navigate(1)}
									className="text-gray-700 hover:text-gray-400 transition-colors"
								>
									<svg
										className="w-5 h-5"
										fill="none"
										viewBox="0 0 24 24"
										stroke="currentColor"
										strokeWidth={2}
									>
										<title>Next event</title>
										<path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
									</svg>
								</button>
							</div>
						)}

						{/* Context cards BELOW */}
						<div className="flex flex-col items-center gap-1 mt-3">
							{contextBelow.map(({event, distance}) => (
								<ContextCard
									key={event.id}
									event={event}
									agents={agents}
									distance={distance}
									onClick={() => setFocusIndex(focusIndex + distance)}
								/>
							))}
						</div>

						{/* Keyboard hints */}
						<div className="flex justify-center gap-6 mt-8 text-[10px] text-gray-700 uppercase tracking-widest">
							<span>Arrow keys to navigate</span>
							<span>Enter to expand</span>
							<span>Esc to collapse</span>
						</div>
					</div>
				</div>
			)}
		</div>
	)
}

/** Context card -- a muted, compact representation of an event near the focused one */
function ContextCard({
	event,
	agents,
	distance,
	onClick,
}: {
	event: Event
	agents: AgentNode[]
	distance: number
	onClick: () => void
}) {
	const agentColor = getAgentColor(agents, event.agentId)
	const agent = agents.find((a) => a.id === event.agentId)

	return (
		<button
			type="button"
			onClick={onClick}
			className="w-full max-w-3xl flex items-center gap-3 px-4 py-2 rounded-lg border border-gray-800/40 transition-all duration-200 hover:border-gray-700/60 cursor-pointer"
			style={{
				opacity: contextOpacity(distance - 1),
				transform: `scale(${contextScale(distance - 1)})`,
			}}
		>
			{/* Agent color bar */}
			<div className="w-0.5 h-6 rounded-full flex-shrink-0" style={{backgroundColor: agentColor}} />

			{/* Time */}
			<span className="text-[10px] text-gray-500 font-mono flex-shrink-0 tabular-nums">
				{formatTime(event.timestamp)}
			</span>

			{/* Agent */}
			<span className="text-[10px] flex-shrink-0" style={{color: agentColor}}>
				{agent?.name || event.agentId?.slice(0, 8) || "main"}
			</span>

			{/* Type badge */}
			<span className={`text-[10px] px-1 py-0.5 rounded ${getEventTypeBadgeClass(event.type)}`}>
				{event.type}
			</span>

			{/* Summary */}
			<span className="text-xs text-gray-500 truncate flex-1 text-left">{getEventSummary(event)}</span>
		</button>
	)
}

/** The focused event card -- full detail, prominent styling */
function FocusedCard({
	event,
	agents,
	index,
	total,
	detailOpen,
	onToggleDetail,
}: {
	event: Event
	agents: AgentNode[]
	index: number
	total: number
	detailOpen: boolean
	onToggleDetail: () => void
}) {
	const agentColor = getAgentColor(agents, event.agentId)
	const agent = agents.find((a) => a.id === event.agentId)

	return (
		<div
			className="max-w-3xl mx-auto rounded-xl border border-gray-700/60 bg-gray-900/80 overflow-hidden transition-all duration-200"
			style={{boxShadow: `0 0 40px 2px ${agentColor}15, 0 4px 20px rgba(0,0,0,0.4)`}}
		>
			{/* Header */}
			<div className="flex items-center gap-3 px-5 py-3 border-b border-gray-800/60">
				{/* Agent color indicator */}
				<div className="w-1 h-8 rounded-full flex-shrink-0" style={{backgroundColor: agentColor}} />

				{/* Sequence */}
				<span className="text-xs text-gray-600 font-mono tabular-nums">
					{index + 1}/{total}
				</span>

				{/* Time */}
				<span className="text-xs text-gray-400 font-mono tabular-nums">{formatTime(event.timestamp)}</span>

				{/* Agent name */}
				<span className="text-xs font-semibold" style={{color: agentColor}}>
					{agent?.name || event.agentId?.slice(0, 8) || "main"}
				</span>

				{/* Type badge */}
				<span className={`text-xs px-2 py-0.5 rounded font-medium ${getEventTypeBadgeClass(event.type)}`}>
					{event.type}
				</span>

				<div className="flex-1" />

				{/* Toggle detail button */}
				<button
					type="button"
					onClick={onToggleDetail}
					className="text-xs text-gray-500 hover:text-gray-300 transition-colors px-2 py-1 rounded border border-gray-700/50 hover:border-gray-600"
				>
					{detailOpen ? "Collapse" : "Expand"}
				</button>
			</div>

			{/* Summary row -- always visible */}
			<div className="px-5 py-3">
				<div className="text-sm text-gray-300">{getEventSummary(event)}</div>
			</div>

			{/* Expanded detail */}
			{detailOpen && (
				<div className="px-5 pb-4 animate-[slideDown_150ms_ease-out]">
					<div className="border-t border-gray-800/50 pt-4">
						<FocusEventContent event={event} />
					</div>
				</div>
			)}
		</div>
	)
}

function FocusEventContent({event}: {event: Event}) {
	const {data} = event

	switch (data.type) {
		case "user-message":
			return (
				<div className="bg-gray-800/40 p-4 rounded-lg border border-gray-700/40">
					<MarkdownContent>{data.text}</MarkdownContent>
				</div>
			)
		case "assistant-message":
			return (
				<div className="bg-gray-800/40 p-4 rounded-lg border border-gray-700/40">
					<MarkdownContent>{data.text}</MarkdownContent>
				</div>
			)
		case "thinking":
			return (
				<div className="bg-gray-800/40 p-4 rounded-lg border border-gray-700/40">
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
					<pre className="text-xs text-gray-300 whitespace-pre-wrap bg-gray-800/40 p-4 rounded-lg border border-gray-700/40 overflow-x-auto">
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
					<pre className="text-xs text-gray-300 whitespace-pre-wrap bg-gray-800/40 p-4 rounded-lg border border-gray-700/40 overflow-x-auto max-h-96 overflow-y-auto">
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
					<div className="bg-gray-800/40 p-4 rounded-lg border border-gray-700/40">
						<MarkdownContent>{data.prompt}</MarkdownContent>
					</div>
				</div>
			)
		case "summary":
			return (
				<div className="text-sm text-gray-300 bg-gray-800/40 p-4 rounded-lg border border-gray-700/40">
					{data.summary}
				</div>
			)
		default:
			return (
				<pre className="text-xs text-gray-500 whitespace-pre-wrap bg-gray-800/40 p-4 rounded-lg border border-gray-700/40">
					{JSON.stringify(data, null, 2)}
				</pre>
			)
	}
}
