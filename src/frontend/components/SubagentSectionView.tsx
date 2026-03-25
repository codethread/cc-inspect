import {useEffect, useState} from "react"
import type {AgentNode, Event} from "#types"
import {getAgentColorSet} from "./session-view/agent-colors"
import {formatAgentModelLabel, formatTokenCount, getPendingTaskDescriptions, isAgentComplete} from "./session-view/helpers"
import type {SubagentSection} from "./session-view/types"
import {TurnView} from "./TurnView"
import {TurnWrapper} from "./TurnWrapper"

function AgentLabel({
	label,
	modelLabel,
	totalTokens,
	colorClass,
}: {label: string; modelLabel: string | null; totalTokens?: number; colorClass: string}) {
	const subtitle = [modelLabel, totalTokens != null ? formatTokenCount(totalTokens) : null].filter(Boolean).join(" · ")
	return (
		<span className="flex flex-col min-w-0">
			<span className={`text-xs font-semibold uppercase tracking-wide ${colorClass}`}>{label}</span>
			{subtitle && <span className="text-[10px] text-zinc-500 tracking-wide">{subtitle}</span>}
		</span>
	)
}

export function SubagentSectionView({
	section,
	agents,
	allEvents,
	selectedEventId,
	onSelectEvent,
	onTurnVisible,
	defaultToolsExpanded = false,
	defaultAgentsExpanded = false,
	onDrilldown,
}: {
	section: SubagentSection
	agents: AgentNode[]
	allEvents: Event[]
	selectedEventId: string | null
	onSelectEvent: (event: Event) => void
	onTurnVisible: (id: string) => void
	defaultToolsExpanded?: boolean
	defaultAgentsExpanded?: boolean
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
	const modelLabel = formatAgentModelLabel(agent?.model, agent?.subagentType)

	const [isExpanded, setIsExpanded] = useState(defaultAgentsExpanded)

	// Sync local expanded state when global toggle changes
	useEffect(() => {
		setIsExpanded(defaultAgentsExpanded)
	}, [defaultAgentsExpanded])

	const isComplete = isAgentComplete(section.agentId, allEvents)

	if (!isComplete) {
		// In-progress: collapsed header with spinner, clickable to drilldown
		return (
			<div data-agent-section={section.agentId} className={`ml-3 pl-4 border rounded-xl py-3 pr-4 ${colors.bg} ${colors.border} animate-pulse`}>
				<button
					type="button"
					onClick={() => onDrilldown?.(section.agentId)}
					className="flex items-center gap-2 w-full text-left cursor-pointer"
				>
					<span className="w-2 h-2 rounded-full flex-shrink-0" style={{backgroundColor: colors.dot}} />
					<AgentLabel label={label} modelLabel={modelLabel} totalTokens={agent?.totalTokens} colorClass={colors.text} />
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

	// Completed: collapsed header with expand toggle and drilldown
	return (
		<div data-agent-section={section.agentId} className={`ml-3 pl-4 border rounded-xl py-3 pr-4 ${colors.bg} ${colors.border}`}>
			<div className="flex items-center gap-2">
				<span className="w-2 h-2 rounded-full flex-shrink-0" style={{backgroundColor: colors.dot}} />
				<AgentLabel label={label} modelLabel={modelLabel} totalTokens={agent?.totalTokens} colorClass={colors.text} />
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
				{/* Drilldown button */}
				<button
					type="button"
					onClick={() => onDrilldown?.(section.agentId)}
					className="ml-auto p-0.5 rounded transition-colors cursor-pointer text-zinc-500 hover:text-zinc-300"
					title="Open agent view"
				>
					<svg
						className="w-3.5 h-3.5"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						aria-hidden="true"
					>
						<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
					</svg>
				</button>
				<button
					type="button"
					onClick={() => setIsExpanded((v) => !v)}
					className="p-0.5 rounded transition-colors cursor-pointer text-zinc-500 hover:text-zinc-300"
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
