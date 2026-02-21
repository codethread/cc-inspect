import {create} from "zustand"
import type {Event} from "#types"

interface SelectionState {
	selectedEvent: Event | null
	activeTurnId: string | null
	setSelectedEvent: (event: Event | null) => void
	setActiveTurnId: (id: string | null) => void
}

export const useSelectionStore = create<SelectionState>((set) => ({
	selectedEvent: null,
	activeTurnId: null,
	setSelectedEvent: (selectedEvent) => set({selectedEvent}),
	setActiveTurnId: (activeTurnId) => set({activeTurnId}),
}))
