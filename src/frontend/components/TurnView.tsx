import {useMemo} from "react"
import type {AgentNode, Event} from "#types"
import {getAgentColorSet} from "./session-view/agent-colors"
import {groupTurnEvents} from "./session-view/grouping"
import {formatTime, getEventSummary} from "./session-view/helpers"
import type {Turn} from "./session-view/types"
import {ToolGroupAccordion} from "./ToolGroupAccordion"

function UserMessageBlock({
	event,
	isActive,
	onClick,
}: {
	event: Event
	isActive: boolean
	onClick: () => void
}) {
	if (event.data.type !== "user-message") return null
	return (
		<button
			type="button"
			onClick={onClick}
			className={`w-full text-left bg-sky-500/5 border rounded-xl px-5 py-4 transition-colors cursor-pointer ${
				isActive ? "border-sky-400/40 ring-1 ring-sky-400/20" : "border-sky-500/15 hover:border-sky-500/30"
			}`}
			data-event-id={event.id}
		>
			<div className="flex items-center gap-2 mb-2">
				<span className="text-xs font-semibold text-sky-400 uppercase tracking-wider">User</span>
				<span className="text-xs text-zinc-600">{formatTime(event.timestamp)}</span>
			</div>
			<div className="text-zinc-200 text-sm leading-relaxed line-clamp-3">{event.data.text}</div>
		</button>
	)
}

function AssistantMessageBlock({
	event,
	isActive,
	onClick,
}: {
	event: Event
	isActive: boolean
	onClick: () => void
}) {
	if (event.data.type !== "assistant-message") return null
	return (
		<button
			type="button"
			onClick={onClick}
			className={`w-full text-left px-1 py-1 rounded-lg transition-colors cursor-pointer ${
				isActive ? "bg-zinc-800/50 ring-1 ring-violet-400/20" : "hover:bg-zinc-800/30"
			}`}
			data-event-id={event.id}
		>
			<div className="flex items-center gap-2 mb-1.5 px-1">
				<span className="text-xs font-semibold text-violet-400 uppercase tracking-wider">Assistant</span>
				<span className="text-xs text-zinc-600">{formatTime(event.timestamp)}</span>
			</div>
			<div className="text-zinc-200 text-sm leading-relaxed line-clamp-3 px-1">{event.data.text}</div>
		</button>
	)
}

function ThinkingBlock({event, isActive, onClick}: {event: Event; isActive: boolean; onClick: () => void}) {
	if (event.data.type !== "thinking") return null
	return (
		<button
			type="button"
			onClick={onClick}
			className={`w-full text-left px-1 py-1 rounded-lg transition-colors cursor-pointer ${
				isActive ? "bg-zinc-800/50 ring-1 ring-fuchsia-400/20" : "hover:bg-zinc-800/30"
			}`}
			data-event-id={event.id}
		>
			<div className="flex items-center gap-2 mb-1 px-1">
				<span className="text-xs font-semibold text-fuchsia-400/70 uppercase tracking-wider">Thinking</span>
				<span className="text-xs text-zinc-600">{formatTime(event.timestamp)}</span>
			</div>
			<div className="pl-1 text-zinc-600 text-sm truncate italic">{event.data.content.slice(0, 120)}</div>
		</button>
	)
}

function AgentSpawnBlock({event, isActive, onClick}: {event: Event; isActive: boolean; onClick: () => void}) {
	if (event.data.type !== "agent-spawn") return null
	return (
		<button
			type="button"
			onClick={onClick}
			className={`w-full text-left bg-orange-500/5 border rounded-xl px-5 py-4 transition-colors cursor-pointer ${
				isActive
					? "border-orange-400/40 ring-1 ring-orange-400/20"
					: "border-orange-500/15 hover:border-orange-500/30"
			}`}
			data-event-id={event.id}
		>
			<div className="flex items-center gap-2 mb-2">
				<span className="text-xs font-semibold text-orange-400 uppercase tracking-wider">Agent Spawned</span>
				<span className="text-xs text-zinc-600">{formatTime(event.timestamp)}</span>
			</div>
			<div className="text-zinc-300 text-sm">{event.data.description}</div>
		</button>
	)
}

function SummaryBlock({event, isActive, onClick}: {event: Event; isActive: boolean; onClick: () => void}) {
	if (event.data.type !== "summary") return null
	return (
		<button
			type="button"
			onClick={onClick}
			className={`w-full text-left bg-zinc-800/30 border rounded-xl px-5 py-4 transition-colors cursor-pointer ${
				isActive ? "border-zinc-600 ring-1 ring-zinc-500/20" : "border-zinc-700/30 hover:border-zinc-700"
			}`}
			data-event-id={event.id}
		>
			<div className="flex items-center gap-2 mb-2">
				<span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Summary</span>
				<span className="text-xs text-zinc-600">{formatTime(event.timestamp)}</span>
			</div>
			<div className="text-zinc-400 text-sm leading-relaxed line-clamp-3">{event.data.summary}</div>
		</button>
	)
}

export function TurnView({
	turn,
	agents,
	allEvents,
	selectedEventId,
	onSelectEvent,
	hideAgentLabel,
	defaultToolsExpanded = true,
}: {
	turn: Turn
	agents: AgentNode[]
	allEvents: Event[]
	selectedEventId: string | null
	onSelectEvent: (event: Event) => void
	hideAgentLabel?: boolean
	defaultToolsExpanded?: boolean
}) {
	const colors = getAgentColorSet(agents, turn.agentId)

	const toolResultMap = useMemo(() => {
		const map = new Map<string, Event>()
		for (const e of allEvents) {
			if (e.data.type === "tool-result") {
				map.set(e.data.toolUseId, e)
			}
		}
		return map
	}, [allEvents])

	const pairedResultIds = useMemo(() => {
		const ids = new Set<string>()
		for (const e of turn.events) {
			if (e.data.type === "tool-use") {
				const result = toolResultMap.get(e.data.toolId)
				if (result) ids.add(result.id)
			}
		}
		return ids
	}, [turn.events, toolResultMap])

	const timelineItems = useMemo(
		() => groupTurnEvents(turn.events, pairedResultIds),
		[turn.events, pairedResultIds],
	)

	return (
		<div className="scroll-mt-16">
			{!hideAgentLabel && agents.length > 1 && (
				<div className="flex items-center gap-2 mb-2">
					<span className="w-2 h-2 rounded-full" style={{backgroundColor: colors.dot}} />
					<span className={`text-xs font-medium ${colors.text}`}>
						{turn.agentName ?? turn.agentId?.slice(0, 10) ?? "main"}
					</span>
				</div>
			)}

			<div className="space-y-3">
				{timelineItems.map((item) => {
					if (item.kind === "tool-group") {
						return (
							<ToolGroupAccordion
								key={item.events[0]?.id ?? "tg"}
								group={item}
								toolResultMap={toolResultMap}
								selectedEventId={selectedEventId}
								onSelectEvent={onSelectEvent}
								defaultExpanded={defaultToolsExpanded}
							/>
						)
					}

					const event = item.event
					const isActive = event.id === selectedEventId

					switch (event.data.type) {
						case "user-message":
							return (
								<UserMessageBlock
									key={event.id}
									event={event}
									isActive={isActive}
									onClick={() => onSelectEvent(event)}
								/>
							)
						case "assistant-message":
							return (
								<AssistantMessageBlock
									key={event.id}
									event={event}
									isActive={isActive}
									onClick={() => onSelectEvent(event)}
								/>
							)
						case "thinking":
							return (
								<ThinkingBlock
									key={event.id}
									event={event}
									isActive={isActive}
									onClick={() => onSelectEvent(event)}
								/>
							)
						case "agent-spawn":
							return (
								<AgentSpawnBlock
									key={event.id}
									event={event}
									isActive={isActive}
									onClick={() => onSelectEvent(event)}
								/>
							)
						case "summary":
							return (
								<SummaryBlock
									key={event.id}
									event={event}
									isActive={isActive}
									onClick={() => onSelectEvent(event)}
								/>
							)
						case "tool-use":
						case "tool-result": {
							// Stray tool events not in a group
							const isError = event.data.type === "tool-result" && !event.data.success
							return (
								<button
									key={event.id}
									type="button"
									onClick={() => onSelectEvent(event)}
									className={`w-full text-left px-4 py-2 rounded-lg text-sm transition-colors cursor-pointer ${
										isError
											? `bg-red-500/5 border border-red-500/20 text-red-300 ${isActive ? "ring-1 ring-red-400/30" : "hover:bg-red-500/8"}`
											: `text-zinc-400 ${isActive ? "bg-zinc-800/50 ring-1 ring-zinc-600" : "hover:bg-zinc-800/30"}`
									}`}
									data-event-id={event.id}
								>
									<span className="flex items-center gap-2">
										{isError && <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />}
										{getEventSummary(event)}
									</span>
								</button>
							)
						}
						default:
							return null
					}
				})}
			</div>
		</div>
	)
}
