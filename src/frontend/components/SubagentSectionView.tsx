import {useState} from "react"
import type {AgentNode, Event} from "#types"
import {getAgentColorSet} from "./session-view/agent-colors"
import {getPendingTaskDescriptions, isAgentComplete} from "./session-view/helpers"
import type {SubagentSection} from "./session-view/types"
import {TurnView} from "./TurnView"
import {TurnWrapper} from "./TurnWrapper"

export function SubagentSectionView({
	section,
	agents,
	allEvents,
	selectedEventId,
	onSelectEvent,
	onTurnVisible,
	defaultToolsExpanded = true,
	isTailing = false,
	onDrilldown,
}: {
	section: SubagentSection
	agents: AgentNode[]
	allEvents: Event[]
	selectedEventId: string | null
	onSelectEvent: (event: Event) => void
	onTurnVisible: (id: string) => void
	defaultToolsExpanded?: boolean
	isTailing?: boolean
	onDrilldown?: (agentId: string) => void
}) {
	const colors = getAgentColorSet(agents, section.agentId)
	const agent = section.agent
	// Exclude name if it's the raw agentId fallback set before tool_result arrives
	const resolvedName = agent?.name !== section.agentId ? agent?.name : undefined
	// When no real label is available yet, match to a pending Task description by position.
	// Agents are discovered (and added to the children array) in the same order their Task
	// tool_uses fire, so the Nth stale agent maps to the Nth pending Task description.
	const pendingDescriptions = getPendingTaskDescriptions(allEvents)
	let pendingDescription: string | undefined
	if (!agent?.description && !resolvedName && !agent?.subagentType) {
		const staleAgentIds = agents.filter((a) => a.name === a.id).map((a) => a.id)
		const idx = staleAgentIds.indexOf(section.agentId)
		if (idx !== -1) pendingDescription = pendingDescriptions[idx]
	}
	const label =
		[agent?.description, resolvedName, agent?.subagentType, pendingDescription].find((s) => s?.trim()) ??
		"Agent"

	// Transient expanded state — only relevant in tailing completed-agent mode
	const [isExpanded, setIsExpanded] = useState(false)

	if (isTailing) {
		const isComplete = isAgentComplete(section.agentId, allEvents)

		if (!isComplete) {
			// In-progress: collapsed header with spinner, clickable to drilldown
			return (
				<div className={`ml-3 pl-4 border rounded-xl py-3 pr-4 ${colors.bg} ${colors.border} animate-pulse`}>
					<button
						type="button"
						onClick={() => onDrilldown?.(section.agentId)}
						className="flex items-center gap-2 w-full text-left cursor-pointer"
					>
						<span className="w-2 h-2 rounded-full flex-shrink-0" style={{backgroundColor: colors.dot}} />
						<span className={`text-xs font-semibold uppercase tracking-wide ${colors.text}`}>{label}</span>
						{/* Animated spinner */}
						<svg
							className="w-3 h-3 animate-spin ml-auto flex-shrink-0 text-zinc-500"
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
					</button>
				</div>
			)
		}

		// Completed: collapsed header with expand toggle
		return (
			<div className={`ml-3 pl-4 border rounded-xl py-3 pr-4 ${colors.bg} ${colors.border}`}>
				<div className="flex items-center gap-2">
					<span className="w-2 h-2 rounded-full flex-shrink-0" style={{backgroundColor: colors.dot}} />
					<span className={`text-xs font-semibold uppercase tracking-wide ${colors.text}`}>{label}</span>
					{/* Completion indicator */}
					<svg
						className="w-3 h-3 flex-shrink-0 text-emerald-500"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						aria-hidden="true"
					>
						<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
					</svg>
					<button
						type="button"
						onClick={() => setIsExpanded((v) => !v)}
						className={`ml-auto p-0.5 rounded transition-colors cursor-pointer text-zinc-500 hover:text-zinc-300`}
						title={isExpanded ? "Collapse" : "Expand"}
					>
						<svg
							className={`w-3.5 h-3.5 transition-transform ${isExpanded ? "rotate-180" : ""}`}
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							aria-hidden="true"
						>
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
						</svg>
					</button>
				</div>

				{isExpanded && (
					<div className="space-y-8 mt-4">
						{section.turns.map((turn) => (
							<TurnWrapper key={turn.id} turnId={turn.id} onVisible={onTurnVisible}>
								<TurnView
									turn={turn}
									agents={agents}
									allEvents={allEvents}
									selectedEventId={selectedEventId}
									onSelectEvent={onSelectEvent}
									hideAgentLabel
									defaultToolsExpanded={defaultToolsExpanded}
								/>
							</TurnWrapper>
						))}
					</div>
				)}
			</div>
		)
	}

	// Static (non-tailing) mode: render all turns inline, unchanged
	return (
		<div className={`ml-3 pl-4 border rounded-xl py-4 pr-4 ${colors.bg} ${colors.border}`}>
			{/* Subagent header */}
			<div className="flex items-center gap-2 mb-4">
				<span className="w-2 h-2 rounded-full flex-shrink-0" style={{backgroundColor: colors.dot}} />
				<span className={`text-xs font-semibold uppercase tracking-wide ${colors.text}`}>{label}</span>
			</div>

			<div className="space-y-8">
				{section.turns.map((turn) => (
					<TurnWrapper key={turn.id} turnId={turn.id} onVisible={onTurnVisible}>
						<TurnView
							turn={turn}
							agents={agents}
							allEvents={allEvents}
							selectedEventId={selectedEventId}
							onSelectEvent={onSelectEvent}
							hideAgentLabel
							defaultToolsExpanded={defaultToolsExpanded}
						/>
					</TurnWrapper>
				))}
			</div>
		</div>
	)
}
