import type {AgentNode, Event, SessionData} from "#types"
import {useUIStore} from "../stores/ui-store"
import {getAgentColorSet} from "./session-view/agent-colors"
import {groupIntoTurns} from "./session-view/grouping"
import {getPendingTaskDescriptions, isAgentComplete} from "./session-view/helpers"
import {TurnView} from "./TurnView"
import {TurnWrapper} from "./TurnWrapper"

export function SubagentDrilldown({
	agentId,
	sessionData,
	agents,
	selectedEventId,
	onSelectEvent,
	onTurnVisible,
	defaultToolsExpanded,
	isNewEvent,
}: {
	agentId: string
	sessionData: SessionData
	agents: AgentNode[]
	selectedEventId: string | null
	onSelectEvent: (event: Event) => void
	onTurnVisible: (id: string) => void
	defaultToolsExpanded: boolean
	isNewEvent: (eventId: string) => boolean
}) {
	const setDrilldownAgentId = useUIStore((s) => s.setDrilldownAgentId)

	const colors = getAgentColorSet(agents, agentId)
	const agentNode = agents.find((a) => a.id === agentId) ?? null
	const resolvedName = agentNode?.name !== agentId ? agentNode?.name : undefined
	const pendingDescriptions = getPendingTaskDescriptions(sessionData.allEvents)
	let pendingDescription: string | undefined
	if (!agentNode?.description && !resolvedName && !agentNode?.subagentType) {
		const staleAgentIds = agents.filter((a) => a.name === a.id).map((a) => a.id)
		const idx = staleAgentIds.indexOf(agentId)
		if (idx !== -1) pendingDescription = pendingDescriptions[idx]
	}
	const label =
		[agentNode?.description, resolvedName, agentNode?.subagentType, pendingDescription].find((s) =>
			s?.trim(),
		) ?? agentId.slice(0, 12)

	const isComplete = isAgentComplete(agentId, sessionData.allEvents)

	// Filter to events belonging to this agent, then group into turns.
	// Use agentId as the "mainAgentId" so task-result routing doesn't misroute events.
	const agentEvents = sessionData.allEvents.filter((e) => e.agentId === agentId)
	const turns = groupIntoTurns(agentEvents, agentId)

	return (
		<div className="max-w-3xl mx-auto px-6 py-8 space-y-8">
			{/* Breadcrumb */}
			<div className="flex items-center gap-2 text-sm">
				<button
					type="button"
					onClick={() => setDrilldownAgentId(null)}
					className="text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer"
				>
					Main Agent
				</button>
				<svg
					className="w-3.5 h-3.5 text-zinc-600 flex-shrink-0"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					aria-hidden="true"
				>
					<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
				</svg>
				<span className="flex items-center gap-1.5" style={{color: colors.dot}}>
					<span className="w-2 h-2 rounded-full flex-shrink-0" style={{backgroundColor: colors.dot}} />
					<span className={`font-semibold uppercase tracking-wide text-xs`}>{label}</span>
				</span>
				{/* Completion status indicator */}
				{isComplete ? (
					<svg
						className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 ml-1"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						aria-hidden="true"
					>
						<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
					</svg>
				) : (
					<svg
						className="w-3 h-3 animate-spin text-zinc-500 flex-shrink-0 ml-1"
						viewBox="0 0 24 24"
						fill="none"
						aria-hidden="true"
					>
						<circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
						<path
							className="opacity-75"
							fill="currentColor"
							d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
						/>
					</svg>
				)}
			</div>

			{/* Turns */}
			{turns.map((turn) => {
				const isNew = turn.events.some((e) => isNewEvent(e.id))
				return (
					<div key={turn.id} className={isNew ? "tail-new-event" : undefined}>
						<TurnWrapper turnId={turn.id} onVisible={onTurnVisible}>
							<TurnView
								turn={turn}
								agents={agents}
								allEvents={sessionData.allEvents}
								selectedEventId={selectedEventId}
								onSelectEvent={onSelectEvent}
								hideAgentLabel
								defaultToolsExpanded={defaultToolsExpanded}
							/>
						</TurnWrapper>
					</div>
				)
			})}
		</div>
	)
}
