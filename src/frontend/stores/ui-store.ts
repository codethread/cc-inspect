import {create} from "zustand"
import {persist} from "zustand/middleware"

interface UIState {
	filterOpen: boolean
	searchOpen: boolean
	shortcutsOpen: boolean
	showOutline: boolean
	allToolsExpanded: boolean
	setFilterOpen: (open: boolean) => void
	setSearchOpen: (open: boolean) => void
	setShortcutsOpen: (open: boolean) => void
	setShowOutline: (show: boolean) => void
	setAllToolsExpanded: (expanded: boolean) => void
}

export const useUIStore = create<UIState>()(
	persist(
		(set) => ({
			filterOpen: false,
			searchOpen: false,
			shortcutsOpen: false,
			showOutline: true,
			allToolsExpanded: true,
			setFilterOpen: (open) => set({filterOpen: open}),
			setSearchOpen: (open) => set({searchOpen: open}),
			setShortcutsOpen: (open) => set({shortcutsOpen: open}),
			setShowOutline: (show) => set({showOutline: show}),
			setAllToolsExpanded: (expanded) => set({allToolsExpanded: expanded}),
		}),
		{
			name: "cc-inspect-ui",
			partialize: (state) => ({
				showOutline: state.showOutline,
				allToolsExpanded: state.allToolsExpanded,
			}),
		},
	),
)
