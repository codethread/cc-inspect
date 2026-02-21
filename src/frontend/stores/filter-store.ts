import {create} from "zustand"
import type {EventType} from "#types"

interface FilterState {
	search: string
	typeInclude: Set<EventType>
	typeExclude: Set<EventType>
	agentFilter: Set<string>
	errorsOnly: boolean
	setSearch: (s: string) => void
	setTypeInclude: (s: Set<EventType>) => void
	setTypeExclude: (s: Set<EventType>) => void
	setAgentFilter: (s: Set<string>) => void
	setErrorsOnly: (v: boolean) => void
	clearFilters: () => void
}

export const useFilterStore = create<FilterState>((set) => ({
	search: "",
	typeInclude: new Set(),
	typeExclude: new Set(),
	agentFilter: new Set(),
	errorsOnly: false,
	setSearch: (search) => set({search}),
	setTypeInclude: (typeInclude) => set({typeInclude}),
	setTypeExclude: (typeExclude) => set({typeExclude}),
	setAgentFilter: (agentFilter) => set({agentFilter}),
	setErrorsOnly: (errorsOnly) => set({errorsOnly}),
	clearFilters: () =>
		set({
			search: "",
			typeInclude: new Set(),
			typeExclude: new Set(),
			agentFilter: new Set(),
			errorsOnly: false,
		}),
}))
