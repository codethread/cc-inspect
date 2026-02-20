import {useEffect, useState} from "react"
import type {Event} from "#types"
import {formatTime, getEventSummary} from "./session-view/helpers"
import type {ToolCallGroup} from "./session-view/types"

export function ToolGroupAccordion({
	group,
	toolResultMap,
	selectedEventId,
	onSelectEvent,
	defaultExpanded = true,
}: {
	group: ToolCallGroup
	toolResultMap: Map<string, Event>
	selectedEventId: string | null
	onSelectEvent: (event: Event) => void
	defaultExpanded?: boolean
}) {
	const [expanded, setExpanded] = useState(defaultExpanded)

	useEffect(() => {
		setExpanded(defaultExpanded)
	}, [defaultExpanded])

	const summaryText =
		group.toolNames.length <= 3
			? group.toolNames.join(", ")
			: `${group.toolNames.slice(0, 3).join(", ")} +${group.toolNames.length - 3}`

	const failureCount = group.events.reduce((count, e) => {
		if (e.data.type === "tool-use") {
			const result = toolResultMap.get(e.data.toolId)
			if (result?.data.type === "tool-result" && !result.data.success) return count + 1
		}
		return count
	}, 0)
	const hasFailures = failureCount > 0

	return (
		<div
			className={`border rounded-xl overflow-hidden ${hasFailures ? "border-red-500/30" : "border-zinc-800"}`}
		>
			<button
				type="button"
				onClick={() => setExpanded(!expanded)}
				className={`w-full flex items-center gap-3 px-4 py-2.5 hover:bg-zinc-800/50 transition-colors cursor-pointer text-left ${
					hasFailures ? "bg-red-500/5" : "bg-zinc-900/50"
				}`}
			>
				<svg
					className={`w-3 h-3 transition-transform flex-shrink-0 ${expanded ? "rotate-90" : ""} ${
						hasFailures ? "text-red-400" : "text-zinc-500"
					}`}
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					aria-hidden="true"
				>
					<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
				</svg>
				{hasFailures && <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />}
				<span className={`font-mono text-xs font-medium ${hasFailures ? "text-red-400" : "text-amber-400"}`}>
					{group.toolNames.length} tool call
					{group.toolNames.length !== 1 ? "s" : ""}
				</span>
				<span className="text-zinc-500 text-xs truncate">{summaryText}</span>
				{hasFailures && (
					<span className="text-red-400 text-xs flex-shrink-0 font-medium">{failureCount} failed</span>
				)}
			</button>
			{expanded && (
				<div className={`border-t ${hasFailures ? "border-red-500/20" : "border-zinc-800"}`}>
					{group.events.map((event) => {
						if (event.type === "tool-result") return null
						const isActive = event.id === selectedEventId
						const summary = getEventSummary(event)
						const result = event.data.type === "tool-use" ? toolResultMap.get(event.data.toolId) : null
						const success = result?.data.type === "tool-result" ? result.data.success : null
						const isFailed = success === false

						return (
							<button
								key={event.id}
								type="button"
								onClick={() => onSelectEvent(event)}
								className={`w-full text-left flex items-center gap-3 px-4 py-2 border-b last:border-0 transition-colors cursor-pointer ${
									isFailed
										? `border-l-2 border-l-red-400 bg-red-500/5 border-b-red-500/10 ${isActive ? "bg-red-500/10" : "hover:bg-red-500/8"}`
										: `border-l-2 border-l-transparent border-b-zinc-800/50 ${isActive ? "bg-zinc-800/80" : "hover:bg-zinc-800/40"}`
								}`}
								data-event-id={event.id}
							>
								<span
									className={`font-mono text-xs font-medium flex-shrink-0 ${isFailed ? "text-red-400" : "text-amber-400"}`}
								>
									{event.data.type === "tool-use" ? event.data.toolName : "result"}
								</span>
								{success !== null && (
									<span
										className={`text-xs flex-shrink-0 ${success ? "text-emerald-400" : "text-red-400 font-semibold"}`}
									>
										{success ? "OK" : "ERR"}
									</span>
								)}
								<span className="text-zinc-500 text-xs truncate">{summary}</span>
								<span className="text-xs text-zinc-700 ml-auto flex-shrink-0 tabular-nums">
									{formatTime(event.timestamp)}
								</span>
							</button>
						)
					})}
				</div>
			)}
		</div>
	)
}
