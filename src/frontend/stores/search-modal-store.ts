import {create} from "zustand"
import type {EventType} from "#types"

interface SearchModalState {
	query: string
	selectedIndex: number
	typeFilter: Set<EventType>
	setQuery: (query: string) => void
	setSelectedIndex: (index: number) => void
	setTypeFilter: (typeFilter: Set<EventType>) => void
	reset: () => void
}

export const useSearchModalStore = create<SearchModalState>((set) => ({
	query: "",
	selectedIndex: 0,
	typeFilter: new Set(),
	setQuery: (query) => set({query, selectedIndex: 0}),
	setSelectedIndex: (selectedIndex) => set({selectedIndex}),
	setTypeFilter: (typeFilter) => set({typeFilter}),
	reset: () => set({query: "", selectedIndex: 0, typeFilter: new Set()}),
}))
