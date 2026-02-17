import {useCallback, useEffect, useMemo, useRef, useState} from "react"
import type {AgentNode, Event} from "#types"
import {MarkdownContent} from "../MarkdownContent"
import {SharedFilters} from "../SharedFilters"
import {type FilterState, formatTime, getAgentColor} from "../shared"

interface ConversationViewProps {
	agents: AgentNode[]
	events: Event[]
	filters: FilterState
	onFilterChange: (f: FilterState) => void
}

interface ConversationGroup {
	type: "user" | "assistant" | "tool-group" | "agent-spawn" | "summary" | "thinking"
	events: Event[]
	agentId: string | null
}

export function ConversationView({agents, events, filters, onFilterChange}: ConversationViewProps) {
	const [searchOpen, setSearchOpen] = useState(false)
	const [expandedToolIds, setExpandedToolIds] = useState<Set<string>>(new Set())
	const expandOrder = useRef<string[]>([])

	const groups = useMemo(() => groupConversation(events), [events])

	const toggleTool = useCallback((id: string) => {
		setExpandedToolIds((prev) => {
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

	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				if (searchOpen) {
					setSearchOpen(false)
				} else if (expandOrder.current.length > 0) {
					const lastId = expandOrder.current.pop()
					if (lastId) {
						setExpandedToolIds((prev) => {
							const next = new Set(prev)
							next.delete(lastId)
							return next
						})
					}
				}
			}
			if ((e.metaKey || e.ctrlKey) && e.key === "k") {
				e.preventDefault()
				setSearchOpen((v) => !v)
			}
		}
		window.addEventListener("keydown", handler)
		return () => window.removeEventListener("keydown", handler)
	}, [searchOpen])

	return (
		<div className="max-w-3xl mx-auto relative">
			{/* Cmd+K search trigger */}
			<div className="text-center mb-4">
				<button
					type="button"
					onClick={() => setSearchOpen(true)}
					className="text-xs text-gray-500 hover:text-gray-300 border border-gray-700 rounded px-3 py-1"
				>
					Search/Filter (Cmd+K)
				</button>
			</div>

			{/* Search overlay */}
			{searchOpen && (
				<div className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/60">
					<div className="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl w-full max-w-2xl p-4">
						<SharedFilters agents={agents} filters={filters} onFilterChange={onFilterChange} />
						<div className="text-xs text-gray-500 mt-3 text-right">Esc to close</div>
					</div>
				</div>
			)}

			{/* Conversation stream */}
			<div className="space-y-4">
				{groups.map((group, i) => (
					<ConversationBubble
						key={`group-${i}-${group.events[0]?.id}`}
						group={group}
						agents={agents}
						expandedToolIds={expandedToolIds}
						onToggleTool={toggleTool}
					/>
				))}
			</div>

			{events.length === 0 && (
				<div className="text-center py-12 text-gray-500">No events match the current filters</div>
			)}
		</div>
	)
}

function ConversationBubble({
	group,
	agents,
	expandedToolIds,
	onToggleTool,
}: {
	group: ConversationGroup
	agents: AgentNode[]
	expandedToolIds: Set<string>
	onToggleTool: (id: string) => void
}) {
	const agent = agents.find((a) => a.id === group.agentId)
	const agentName = agent?.name || group.agentId?.slice(0, 8) || "main"
	const agentColor = getAgentColor(agents, group.agentId)

	switch (group.type) {
		case "user":
			return (
				<div className="flex justify-end">
					<div className="max-w-[85%]">
						<div className="text-xs text-gray-500 mb-1 text-right">
							{formatTime(group.events[0]?.timestamp)}
						</div>
						<div className="bg-cyan-900/40 border border-cyan-800/50 rounded-2xl rounded-br-sm px-4 py-3">
							{group.events.map((event) => (
								<div key={event.id}>
									{event.data.type === "user-message" && <MarkdownContent>{event.data.text}</MarkdownContent>}
								</div>
							))}
						</div>
					</div>
				</div>
			)

		case "thinking":
			return (
				<div className="flex justify-start">
					<div className="max-w-[85%]">
						<div className="text-xs mb-1 flex items-center gap-2" style={{color: agentColor}}>
							{agentName}
						</div>
						<div className="text-sm text-gray-500 italic px-4 py-2">
							{group.events.map((event) => (
								<div key={event.id} className="line-clamp-3">
									{event.data.type === "thinking" && event.data.content}
								</div>
							))}
						</div>
					</div>
				</div>
			)

		case "assistant":
			return (
				<div className="flex justify-start">
					<div className="max-w-[85%]">
						<div className="text-xs mb-1 flex items-center gap-2" style={{color: agentColor}}>
							{agentName}
							<span className="text-gray-600">{formatTime(group.events[0]?.timestamp)}</span>
						</div>
						<div className="bg-gray-800 border border-gray-700 rounded-2xl rounded-bl-sm px-4 py-3">
							{group.events.map((event) => (
								<div key={event.id}>
									{event.data.type === "assistant-message" && (
										<MarkdownContent>{event.data.text}</MarkdownContent>
									)}
								</div>
							))}
						</div>
					</div>
				</div>
			)

		case "tool-group":
			return (
				<div className="flex justify-start">
					<div className="max-w-[85%] w-full">
						<div className="text-xs mb-1" style={{color: agentColor}}>
							{agentName}
						</div>
						<div className="space-y-1">
							{group.events.map((event) => {
								if (event.data.type === "tool-use") {
									const isExpanded = expandedToolIds.has(event.id)
									return (
										<div key={event.id}>
											<button
												type="button"
												onClick={() => onToggleTool(event.id)}
												className="w-full text-left bg-gray-800/60 border border-gray-700/50 rounded-lg px-3 py-2 hover:bg-gray-800 transition-colors"
											>
												<div className="flex items-center gap-2 text-sm">
													<span className="text-blue-400 font-mono">{event.data.toolName}</span>
													{event.data.description && (
														<span className="text-gray-500 truncate text-xs">{event.data.description}</span>
													)}
													<span className="text-gray-600 ml-auto flex-shrink-0">
														{isExpanded ? "v" : ">"}
													</span>
												</div>
											</button>
											{isExpanded && <ToolCardExpanded event={event} events={group.events} />}
										</div>
									)
								}
								return null
							})}
						</div>
					</div>
				</div>
			)

		case "agent-spawn":
			return (
				<div className="flex items-center gap-3 py-2">
					<div className="flex-1 h-px bg-gray-800" />
					<div className="text-xs text-yellow-500 px-3 py-1 bg-yellow-900/20 border border-yellow-800/30 rounded-full">
						Agent spawned: {group.events[0]?.data.type === "agent-spawn" && group.events[0].data.agentId}
					</div>
					<div className="flex-1 h-px bg-gray-800" />
				</div>
			)

		case "summary":
			return (
				<div className="flex items-center gap-3 py-2">
					<div className="flex-1 h-px bg-gray-800" />
					<div className="text-xs text-gray-500 px-3">
						{group.events[0]?.data.type === "summary" && group.events[0].data.summary}
					</div>
					<div className="flex-1 h-px bg-gray-800" />
				</div>
			)

		default:
			return null
	}
}

function ToolCardExpanded({event, events}: {event: Event; events: Event[]}) {
	if (event.data.type !== "tool-use") return null

	const toolId = event.data.toolId
	// Find matching tool-result
	const result = events.find((e) => e.data.type === "tool-result" && e.data.toolUseId === toolId)

	return (
		<div className="bg-gray-900 border border-gray-700/50 rounded-b-lg px-3 py-3 space-y-3">
			<div className="text-xs text-gray-400">
				<div className="font-medium mb-1">Input:</div>
				<pre className="whitespace-pre-wrap text-gray-300 bg-gray-800 p-2 rounded overflow-x-auto">
					{JSON.stringify(event.data.input, null, 2)}
				</pre>
			</div>
			{result && result.data.type === "tool-result" && (
				<div className="text-xs text-gray-400">
					<div className="font-medium mb-1">
						Output{" "}
						<span className={result.data.success ? "text-green-400" : "text-red-400"}>
							({result.data.success ? "success" : "error"})
						</span>
						:
					</div>
					<pre className="whitespace-pre-wrap text-gray-300 bg-gray-800 p-2 rounded overflow-x-auto max-h-64 overflow-y-auto">
						{result.data.output}
					</pre>
				</div>
			)}
		</div>
	)
}

function groupConversation(events: Event[]): ConversationGroup[] {
	const groups: ConversationGroup[] = []
	let currentGroup: ConversationGroup | null = null

	for (const event of events) {
		const {type} = event.data

		if (type === "user-message") {
			if (currentGroup?.type !== "user" || currentGroup.agentId !== event.agentId) {
				currentGroup = {type: "user", events: [], agentId: event.agentId}
				groups.push(currentGroup)
			}
			currentGroup.events.push(event)
		} else if (type === "thinking") {
			if (currentGroup?.type !== "thinking" || currentGroup.agentId !== event.agentId) {
				currentGroup = {type: "thinking", events: [], agentId: event.agentId}
				groups.push(currentGroup)
			}
			currentGroup.events.push(event)
		} else if (type === "assistant-message") {
			if (currentGroup?.type !== "assistant" || currentGroup.agentId !== event.agentId) {
				currentGroup = {type: "assistant", events: [], agentId: event.agentId}
				groups.push(currentGroup)
			}
			currentGroup.events.push(event)
		} else if (type === "tool-use" || type === "tool-result") {
			if (currentGroup?.type !== "tool-group" || currentGroup.agentId !== event.agentId) {
				currentGroup = {type: "tool-group", events: [], agentId: event.agentId}
				groups.push(currentGroup)
			}
			currentGroup.events.push(event)
		} else if (type === "agent-spawn") {
			currentGroup = {type: "agent-spawn", events: [event], agentId: event.agentId}
			groups.push(currentGroup)
			currentGroup = null
		} else if (type === "summary") {
			currentGroup = {type: "summary", events: [event], agentId: event.agentId}
			groups.push(currentGroup)
			currentGroup = null
		}
	}

	return groups
}
