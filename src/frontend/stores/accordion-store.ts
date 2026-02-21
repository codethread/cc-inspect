import {create} from "zustand"

interface AccordionState {
	// Per-accordion expanded state keyed by first event ID in the group
	expanded: Map<string, boolean>
	setExpanded: (id: string, isExpanded: boolean) => void
	// Reset all tracked accordions to a given default; used when the global toggle changes
	resetAll: (defaultExpanded: boolean) => void
}

export const useAccordionStore = create<AccordionState>((set) => ({
	expanded: new Map(),
	setExpanded: (id, isExpanded) =>
		set((state) => {
			const next = new Map(state.expanded)
			next.set(id, isExpanded)
			return {expanded: next}
		}),
	resetAll: (defaultExpanded) =>
		set((state) => {
			const next = new Map<string, boolean>()
			for (const key of state.expanded.keys()) {
				next.set(key, defaultExpanded)
			}
			return {expanded: next}
		}),
}))
