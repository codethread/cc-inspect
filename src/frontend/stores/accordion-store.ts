import {create} from "zustand"
import {devtools} from "zustand/middleware"
import {STORE_ACTION, STORE_DEVTOOLS_NAME, STORE_KEY} from "../../lib/event-catalog"
import {withStoreLogging} from "./store-logging-middleware"

interface AccordionState {
	// Per-accordion expanded state keyed by first event ID in the group
	expanded: Map<string, boolean>
	setExpanded: (id: string, isExpanded: boolean) => void
	// Reset all tracked accordions to a given default; used when the global toggle changes
	resetAll: (defaultExpanded: boolean) => void
}

export const useAccordionStore = create<AccordionState>()(
	devtools(
		withStoreLogging(STORE_KEY.ACCORDION, (set) => ({
			expanded: new Map(),
			setExpanded: (id, isExpanded) =>
				set((state) => {
					const next = new Map(state.expanded)
					next.set(id, isExpanded)
					return {expanded: next}
				}, false, {type: STORE_ACTION.ACCORDION.SET_EXPANDED, id, isExpanded}),
			resetAll: (defaultExpanded) =>
				set((state) => {
					const next = new Map<string, boolean>()
					for (const key of state.expanded.keys()) {
						next.set(key, defaultExpanded)
					}
					return {expanded: next}
				}, false, {type: STORE_ACTION.ACCORDION.RESET_ALL, defaultExpanded}),
		})),
		{
			name: STORE_DEVTOOLS_NAME[STORE_KEY.ACCORDION],
		},
	),
)
