import type {AgentNode, EventType} from "#types"
import {ALL_EVENT_TYPES, type FilterState, getAgentColor, getEventTypeBadgeClass} from "./shared"

interface SharedFiltersProps {
	agents: AgentNode[]
	filters: FilterState
	onFilterChange: (filters: FilterState) => void
	className?: string
}

export function SharedFilters({agents, filters, onFilterChange, className = ""}: SharedFiltersProps) {
	const toggleAgent = (agentId: string) => {
		const next = new Set(filters.agents)
		if (next.has(agentId)) {
			next.delete(agentId)
		} else {
			next.add(agentId)
		}
		onFilterChange({...filters, agents: next})
	}

	const toggleEventType = (type: EventType) => {
		const next = new Set(filters.eventTypes)
		if (next.has(type)) {
			next.delete(type)
		} else {
			next.add(type)
		}
		onFilterChange({...filters, eventTypes: next})
	}

	const setSearchText = (searchText: string) => {
		onFilterChange({...filters, searchText})
	}

	const clearAll = () => {
		onFilterChange({agents: new Set(), eventTypes: new Set(), searchText: ""})
	}

	const hasActiveAgentFilter = filters.agents.size > 0
	const hasActiveTypeFilter = filters.eventTypes.size > 0
	const hasFilters = hasActiveAgentFilter || hasActiveTypeFilter || filters.searchText.length > 0

	return (
		<div className={`flex flex-wrap items-center gap-3 ${className}`}>
			{/* Search */}
			<input
				type="text"
				placeholder="Search events..."
				value={filters.searchText}
				onChange={(e) => setSearchText(e.target.value)}
				className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500 w-48"
			/>

			{/* Agent chips */}
			<div className="flex flex-wrap items-center gap-1">
				{agents.map((agent) => {
					const isIncluded = filters.agents.has(agent.id)
					const color = getAgentColor(agents, agent.id)
					return (
						<button
							key={agent.id}
							type="button"
							onClick={() => toggleAgent(agent.id)}
							className={`px-2 py-0.5 rounded-full text-xs font-medium transition-colors border ${
								hasActiveAgentFilter
									? isIncluded
										? "border-current"
										: "border-gray-700 opacity-30"
									: "border-gray-600 opacity-80 hover:opacity-100"
							}`}
							style={{color}}
						>
							{agent.name || agent.id.slice(0, 8)}
						</button>
					)
				})}
			</div>

			{/* Event type toggles */}
			<div className="flex flex-wrap items-center gap-1">
				{ALL_EVENT_TYPES.map((type) => {
					const isIncluded = filters.eventTypes.has(type)
					return (
						<button
							key={type}
							type="button"
							onClick={() => toggleEventType(type)}
							className={`px-2 py-0.5 rounded text-xs transition-opacity ${getEventTypeBadgeClass(type)} ${
								hasActiveTypeFilter
									? isIncluded
										? "opacity-100 ring-1 ring-white/30"
										: "opacity-20"
									: "opacity-70 hover:opacity-100"
							}`}
						>
							{type}
						</button>
					)
				})}
			</div>

			{/* Clear */}
			{hasFilters && (
				<button
					type="button"
					onClick={clearAll}
					className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
				>
					Clear filters
				</button>
			)}
		</div>
	)
}
