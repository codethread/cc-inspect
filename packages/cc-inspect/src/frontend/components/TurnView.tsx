import {type KeyboardEvent, useMemo} from "react"
import type {AgentNode, Event} from "#types"
import {SESSION_EVENT_TYPE} from "../../lib/event-catalog"
import {getAgentColorSet} from "./session-view/agent-colors"
import {groupTurnEvents} from "./session-view/grouping"
import {
	formatAgentModelLabel,
	formatTime,
	getEventSummary,
	normalizeModelFamily,
} from "./session-view/helpers"
import type {Turn} from "./session-view/types"
import {ToolGroupAccordion} from "./ToolGroupAccordion"

// iOS Safari's <button> has an internal anonymous flex context that breaks -webkit-line-clamp on children.
// Using div+role="button" avoids this while preserving keyboard accessibility via handleButtonKeyDown.
function handleButtonKeyDown(e: KeyboardEvent, onClick: () => void) {
	if (e.key === "Enter" || e.key === " ") {
		e.preventDefault()
		onClick()
	}
}

function UserMessageBlock({
	event,
	isActive,
	onClick,
}: {
	event: Event
	isActive: boolean
	onClick: () => void
}) {
	if (event.data.type !== SESSION_EVENT_TYPE.USER_MESSAGE) return null
	const continuedSessionId = event.data.planHandoff?.continuedSessionId
	const isPlanHandoff = Boolean(event.data.planHandoff)
	return (
		// biome-ignore lint/a11y/useSemanticElements: div+role="button" avoids iOS Safari flex bug breaking line-clamp
		<div
			role="button"
			tabIndex={0}
			onClick={onClick}
			onKeyDown={(e) => handleButtonKeyDown(e, onClick)}
			className={`w-full text-left border rounded-xl px-5 py-4 transition-colors cursor-pointer ${
				isPlanHandoff
					? isActive
						? "bg-emerald-500/8 border-emerald-400/40 ring-1 ring-emerald-400/20"
						: "bg-emerald-500/4 border-emerald-500/20 hover:border-emerald-500/35"
					: isActive
						? "bg-sky-500/5 border-sky-400/40 ring-1 ring-sky-400/20"
						: "bg-sky-500/5 border-sky-500/15 hover:border-sky-500/30"
			}`}
			data-event-id={event.id}
		>
			<div className="flex items-center gap-2 mb-2">
				<span
					className={`text-xs font-semibold uppercase tracking-wider ${
						isPlanHandoff ? "text-emerald-400" : "text-sky-400"
					}`}
				>
					{isPlanHandoff ? "Plan Handoff" : "User"}
				</span>
				<span className="text-xs text-zinc-600">{formatTime(event.timestamp)}</span>
			</div>
			{isPlanHandoff ? (
				<div className="space-y-2">
					<div className="text-zinc-200 text-sm leading-relaxed">
						{continuedSessionId
							? `Plan accepted. Continued in session ${continuedSessionId.slice(0, 14)}.`
							: "Plan accepted. Work continued in a new session."}
					</div>
					<div className="text-zinc-500 text-xs line-clamp-2">{event.data.planHandoff?.plan}</div>
				</div>
			) : (
				<div className="text-zinc-200 text-sm leading-relaxed line-clamp-3">{event.data.text}</div>
			)}
		</div>
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
	if (event.data.type !== SESSION_EVENT_TYPE.ASSISTANT_MESSAGE) return null
	const model = normalizeModelFamily(event.data.model)
	return (
		// biome-ignore lint/a11y/useSemanticElements: div+role="button" avoids iOS Safari flex bug breaking line-clamp
		<div
			role="button"
			tabIndex={0}
			onClick={onClick}
			onKeyDown={(e) => handleButtonKeyDown(e, onClick)}
			className={`w-full text-left px-1 py-1 rounded-lg transition-colors cursor-pointer ${
				isActive ? "bg-zinc-800/50 ring-1 ring-violet-400/20" : "hover:bg-zinc-800/30"
			}`}
			data-event-id={event.id}
		>
			<div className="flex items-center gap-2 mb-1.5 px-1">
				<span className="text-xs font-semibold text-violet-400 uppercase tracking-wider">Assistant</span>
				{model && <span className="text-[10px] text-zinc-500">{model}</span>}
				<span className="text-xs text-zinc-600">{formatTime(event.timestamp)}</span>
			</div>
			<div className="text-zinc-200 text-sm leading-relaxed line-clamp-3 px-1">{event.data.text}</div>
		</div>
	)
}

function ThinkingBlock({
	event,
	isActive,
	onClick,
	model,
}: {
	event: Event
	isActive: boolean
	onClick: () => void
	model: string | null
}) {
	if (event.data.type !== SESSION_EVENT_TYPE.THINKING) return null
	return (
		// biome-ignore lint/a11y/useSemanticElements: div+role="button" avoids iOS Safari flex bug breaking line-clamp
		<div
			role="button"
			tabIndex={0}
			onClick={onClick}
			onKeyDown={(e) => handleButtonKeyDown(e, onClick)}
			className={`w-full text-left px-1 py-1 rounded-lg transition-colors cursor-pointer ${
				isActive ? "bg-zinc-800/50 ring-1 ring-fuchsia-400/20" : "hover:bg-zinc-800/30"
			}`}
			data-event-id={event.id}
		>
			<div className="flex items-center gap-2 mb-1 px-1">
				<span className="text-xs font-semibold text-fuchsia-400/70 uppercase tracking-wider">Thinking</span>
				{model && <span className="text-[10px] text-zinc-500">{model}</span>}
				<span className="text-xs text-zinc-600">{formatTime(event.timestamp)}</span>
			</div>
			<div className="pl-1 text-zinc-600 text-sm truncate italic">{event.data.content.slice(0, 120)}</div>
		</div>
	)
}

function AgentSpawnBlock({event, isActive, onClick}: {event: Event; isActive: boolean; onClick: () => void}) {
	if (event.data.type !== SESSION_EVENT_TYPE.AGENT_SPAWN) return null
	const model = normalizeModelFamily(event.data.model)
	return (
		// biome-ignore lint/a11y/useSemanticElements: div+role="button" avoids iOS Safari flex bug breaking line-clamp
		<div
			role="button"
			tabIndex={0}
			onClick={onClick}
			onKeyDown={(e) => handleButtonKeyDown(e, onClick)}
			className={`w-full text-left bg-orange-500/5 border rounded-xl px-5 py-4 transition-colors cursor-pointer ${
				isActive
					? "border-orange-400/40 ring-1 ring-orange-400/20"
					: "border-orange-500/15 hover:border-orange-500/30"
			}`}
			data-event-id={event.id}
		>
			<div className="flex items-center gap-2 mb-2">
				<span className="text-xs font-semibold text-orange-400 uppercase tracking-wider">Agent Spawned</span>
				{model && <span className="text-[10px] text-zinc-500">{model}</span>}
				<span className="text-xs text-zinc-600">{formatTime(event.timestamp)}</span>
			</div>
			<div className="text-zinc-300 text-sm">{event.data.description}</div>
		</div>
	)
}

function SummaryBlock({event, isActive, onClick}: {event: Event; isActive: boolean; onClick: () => void}) {
	if (event.data.type !== SESSION_EVENT_TYPE.SUMMARY) return null
	return (
		// biome-ignore lint/a11y/useSemanticElements: div+role="button" avoids iOS Safari flex bug breaking line-clamp
		<div
			role="button"
			tabIndex={0}
			onClick={onClick}
			onKeyDown={(e) => handleButtonKeyDown(e, onClick)}
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
		</div>
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
	const turnAgent = turn.agentId ? agents.find((a) => a.id === turn.agentId) : agents[0]
	const turnModelLabel = formatAgentModelLabel(turnAgent?.model, turnAgent?.subagentType)
	const turnModelFamily = normalizeModelFamily(turnAgent?.model)

	const toolResultMap = useMemo(() => {
		const map = new Map<string, Event>()
		for (const e of allEvents) {
			if (e.data.type === SESSION_EVENT_TYPE.TOOL_RESULT) {
				map.set(e.data.toolUseId, e)
			}
		}
		return map
	}, [allEvents])

	const pairedResultIds = useMemo(() => {
		const ids = new Set<string>()
		for (const e of turn.events) {
			if (e.data.type === SESSION_EVENT_TYPE.TOOL_USE) {
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
					<span className="flex flex-col min-w-0">
						<span className={`text-xs font-medium ${colors.text}`}>
							{turn.agentName ?? turn.agentId?.slice(0, 10) ?? "main"}
						</span>
						{turnModelLabel && <span className="text-[10px] text-zinc-500">{turnModelLabel}</span>}
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
						case SESSION_EVENT_TYPE.USER_MESSAGE:
							return (
								<UserMessageBlock
									key={event.id}
									event={event}
									isActive={isActive}
									onClick={() => onSelectEvent(event)}
								/>
							)
						case SESSION_EVENT_TYPE.ASSISTANT_MESSAGE:
							return (
								<AssistantMessageBlock
									key={event.id}
									event={event}
									isActive={isActive}
									onClick={() => onSelectEvent(event)}
								/>
							)
						case SESSION_EVENT_TYPE.THINKING:
							return (
								<ThinkingBlock
									key={event.id}
									event={event}
									isActive={isActive}
									onClick={() => onSelectEvent(event)}
									model={turnModelFamily}
								/>
							)
						case SESSION_EVENT_TYPE.AGENT_SPAWN:
							return (
								<AgentSpawnBlock
									key={event.id}
									event={event}
									isActive={isActive}
									onClick={() => onSelectEvent(event)}
								/>
							)
						case SESSION_EVENT_TYPE.SUMMARY:
							return (
								<SummaryBlock
									key={event.id}
									event={event}
									isActive={isActive}
									onClick={() => onSelectEvent(event)}
								/>
							)
						case SESSION_EVENT_TYPE.TOOL_USE:
						case SESSION_EVENT_TYPE.TOOL_RESULT: {
							// Stray tool events not in a group
							const isError = event.data.type === SESSION_EVENT_TYPE.TOOL_RESULT && !event.data.success
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
