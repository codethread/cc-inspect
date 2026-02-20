import type {AgentNode, Event} from "#types"
import {getAgentColorSet} from "./session-view/agent-colors"
import type {SubagentSection} from "./session-view/types"
import {TurnView} from "./TurnView"

export function SubagentSectionView({
	section,
	agents,
	allEvents,
	selectedEventId,
	onSelectEvent,
	turnRefs,
	defaultToolsExpanded = true,
}: {
	section: SubagentSection
	agents: AgentNode[]
	allEvents: Event[]
	selectedEventId: string | null
	onSelectEvent: (event: Event) => void
	turnRefs: {current: Map<string, HTMLDivElement | null>}
	defaultToolsExpanded?: boolean
}) {
	const colors = getAgentColorSet(agents, section.agentId)
	const agent = section.agent
	const label =
		[agent?.description, agent?.name, agent?.subagentType].find((s) => s?.trim()) ??
		section.agentId.slice(0, 12)

	return (
		<div className={`ml-3 pl-4 border rounded-xl py-4 pr-4 ${colors.bg} ${colors.border}`}>
			{/* Subagent header */}
			<div className="flex items-center gap-2 mb-4">
				<span className="w-2 h-2 rounded-full flex-shrink-0" style={{backgroundColor: colors.dot}} />
				<span className={`text-xs font-semibold uppercase tracking-wide ${colors.text}`}>{label}</span>
			</div>

			<div className="space-y-8">
				{section.turns.map((turn) => (
					<div
						key={turn.id}
						data-turn-id={turn.id}
						ref={(el) => {
							turnRefs.current.set(turn.id, el)
						}}
					>
						<TurnView
							turn={turn}
							agents={agents}
							allEvents={allEvents}
							selectedEventId={selectedEventId}
							onSelectEvent={onSelectEvent}
							hideAgentLabel
							defaultToolsExpanded={defaultToolsExpanded}
						/>
					</div>
				))}
			</div>
		</div>
	)
}
