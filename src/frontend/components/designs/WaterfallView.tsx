import {useCallback, useEffect, useRef, useState} from "react"
import type {AgentNode, Event} from "#types"
import {MarkdownContent} from "../MarkdownContent"
import {SharedFilters} from "../SharedFilters"
import {type FilterState, formatTime, getAgentColor, getEventSummary, getEventTypeBadgeClass} from "../shared"

interface WaterfallViewProps {
	agents: AgentNode[]
	events: Event[]
	filters: FilterState
	onFilterChange: (f: FilterState) => void
}

export function WaterfallView({agents, events, filters, onFilterChange}: WaterfallViewProps) {
	const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
	const expandOrder = useRef<string[]>([])

	const toggleExpand = useCallback((id: string) => {
		setExpandedIds((prev) => {
			const next = new Set(prev)
			if (next.has(id)) {
				next.delete(id)
				expandOrder.current = expandOrder.current.filter((x) => x !== id)
			} else {
				next.add(id)
				expandOrder.current.push(id)
			}
			return next
		})
	}, [])

	const collapseAll = useCallback(() => {
		setExpandedIds(new Set())
		expandOrder.current = []
	}, [])

	const expandAll = useCallback(() => {
		const allIds = new Set(events.map((e) => e.id))
		setExpandedIds(allIds)
		expandOrder.current = events.map((e) => e.id)
	}, [events])

	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape" && expandOrder.current.length > 0) {
				const lastId = expandOrder.current.pop()
				if (lastId) {
					setExpandedIds((prev) => {
						const next = new Set(prev)
						next.delete(lastId)
						return next
					})
				}
			}
		}
		window.addEventListener("keydown", handler)
		return () => window.removeEventListener("keydown", handler)
	}, [])

	return (
		<div>
			{/* Sticky filter bar */}
			<div className="sticky top-0 z-40 bg-gray-950/95 backdrop-blur-sm border-b border-gray-800 pb-3 mb-4">
				<div className="flex items-center gap-4">
					<SharedFilters
						agents={agents}
						filters={filters}
						onFilterChange={onFilterChange}
						className="flex-1"
					/>
					<div className="flex items-center gap-2 flex-shrink-0">
						<button
							type="button"
							onClick={expandAll}
							className="text-xs text-gray-400 hover:text-gray-200 px-2 py-1 border border-gray-700 rounded"
						>
							Expand All
						</button>
						<button
							type="button"
							onClick={collapseAll}
							className="text-xs text-gray-400 hover:text-gray-200 px-2 py-1 border border-gray-700 rounded"
						>
							Collapse All
						</button>
					</div>
				</div>
			</div>

			{/* Event stream */}
			<div className="space-y-0">
				{events.map((event, index) => {
					const isExpanded = expandedIds.has(event.id)
					const agentColor = getAgentColor(agents, event.agentId)
					const agent = agents.find((a) => a.id === event.agentId)

					return (
						<div key={event.id} className="border-b border-gray-800/50">
							{/* Compact row header */}
							<button
								type="button"
								onClick={() => toggleExpand(event.id)}
								className={`w-full text-left flex items-center gap-3 px-3 py-2 transition-colors ${
									isExpanded ? "bg-gray-900" : "hover:bg-gray-900/50"
								}`}
								style={{borderLeft: `3px solid ${agentColor}`}}
							>
								{/* Sequence number */}
								<span className="text-xs text-gray-600 font-mono w-8 text-right flex-shrink-0">
									{index + 1}
								</span>

								{/* Time */}
								<span className="text-xs text-gray-500 font-mono flex-shrink-0">
									{formatTime(event.timestamp)}
								</span>

								{/* Agent badge */}
								<span
									className="text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0 truncate max-w-[120px]"
									style={{color: agentColor}}
								>
									{agent?.name || event.agentId?.slice(0, 8) || "main"}
								</span>

								{/* Type badge */}
								<span
									className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${getEventTypeBadgeClass(event.type)}`}
								>
									{event.type}
								</span>

								{/* Summary */}
								<span className="text-sm text-gray-300 truncate flex-1 min-w-0">
									{getEventSummary(event)}
								</span>

								{/* Expand indicator */}
								<span className="text-gray-600 flex-shrink-0">{isExpanded ? "v" : ">"}</span>
							</button>

							{/* Expanded details */}
							{isExpanded && (
								<div
									className="px-6 py-4 bg-gray-900/80 animate-[slideDown_150ms_ease-out]"
									style={{borderLeft: `3px solid ${agentColor}`}}
								>
									<WaterfallEventContent event={event} />
								</div>
							)}
						</div>
					)
				})}
			</div>

			{events.length === 0 && (
				<div className="text-center py-12 text-gray-500">No events match the current filters</div>
			)}
		</div>
	)
}

function WaterfallEventContent({event}: {event: Event}) {
	const {data} = event

	switch (data.type) {
		case "user-message":
			return (
				<div className="bg-gray-800 p-4 rounded border border-gray-700">
					<MarkdownContent>{data.text}</MarkdownContent>
				</div>
			)
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
					<div className="flex items-center gap-3 text-sm">
						<span className="text-gray-500">Tool:</span>
						<span className="text-blue-400 font-semibold">{data.toolName}</span>
						{data.description && <span className="text-gray-400">- {data.description}</span>}
					</div>
					<pre className="text-xs text-gray-300 whitespace-pre-wrap bg-gray-800 p-4 rounded border border-gray-700 overflow-x-auto">
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
						<span className="text-gray-500">{data.output.length} chars</span>
					</div>
					<pre className="text-xs text-gray-300 whitespace-pre-wrap bg-gray-800 p-4 rounded border border-gray-700 overflow-x-auto max-h-96 overflow-y-auto">
						{data.output}
					</pre>
				</div>
			)
		case "agent-spawn":
			return (
				<div className="space-y-3">
					<div className="flex items-center gap-3 text-sm">
						<span className="text-gray-500">Agent:</span>
						<span className="text-blue-400 font-mono">{data.agentId}</span>
						{data.model && <span className="text-gray-500">({data.model})</span>}
					</div>
					{data.description && <div className="text-sm text-gray-400">{data.description}</div>}
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
