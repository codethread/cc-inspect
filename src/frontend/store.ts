import {create} from "zustand"
import type {Event} from "#types"

interface AppState {
	selectedEvent: Event | null
	selectEvent: (event: Event | null) => void
}

export const useAppStore = create<AppState>((set) => ({
	selectedEvent: null,
	selectEvent: (event) => set({selectedEvent: event}),
}))
