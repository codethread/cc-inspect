import {create} from "zustand"
import {devtools} from "zustand/middleware"
import type {Event} from "#types"
import {STORE_ACTION, STORE_DEVTOOLS_NAME, STORE_KEY} from "../../lib/event-catalog"
import {withStoreLogging} from "./store-logging-middleware"

interface SelectionState {
	selectedEvent: Event | null
	activeTurnId: string | null
	setSelectedEvent: (event: Event | null) => void
	setActiveTurnId: (id: string | null) => void
}

export const useSelectionStore = create<SelectionState>()(
	devtools(
		withStoreLogging(STORE_KEY.SELECTION, (set) => ({
			selectedEvent: null,
			activeTurnId: null,
			setSelectedEvent: (selectedEvent) =>
				set({selectedEvent}, false, {type: STORE_ACTION.SELECTION.SET_SELECTED_EVENT}),
			setActiveTurnId: (activeTurnId) =>
				set({activeTurnId}, false, {type: STORE_ACTION.SELECTION.SET_ACTIVE_TURN_ID, activeTurnId}),
		})),
		{
			name: STORE_DEVTOOLS_NAME[STORE_KEY.SELECTION],
		},
	),
)
