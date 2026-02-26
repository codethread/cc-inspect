import {create} from "zustand"
import {devtools, persist} from "zustand/middleware"
import {STORE_ACTION, STORE_DEVTOOLS_NAME, STORE_KEY, STORE_PERSIST_KEY} from "../../lib/event-catalog"
import {withStoreLogging} from "./store-logging-middleware"

interface UIState {
	filterOpen: boolean
	searchOpen: boolean
	shortcutsOpen: boolean
	showOutline: boolean
	allToolsExpanded: boolean
	drilldownAgentId: string | null
	setFilterOpen: (open: boolean) => void
	setSearchOpen: (open: boolean) => void
	setShortcutsOpen: (open: boolean) => void
	setShowOutline: (show: boolean) => void
	setAllToolsExpanded: (expanded: boolean) => void
	setDrilldownAgentId: (id: string | null) => void
}

export const useUIStore = create<UIState>()(
	devtools(
		persist(
			withStoreLogging(STORE_KEY.UI, (set) => ({
				filterOpen: false,
				searchOpen: false,
				shortcutsOpen: false,
				showOutline: true,
				allToolsExpanded: true,
				drilldownAgentId: null,
				setFilterOpen: (open) =>
					set({filterOpen: open}, false, {type: STORE_ACTION.UI.SET_FILTER_OPEN, open}),
				setSearchOpen: (open) =>
					set({searchOpen: open}, false, {type: STORE_ACTION.UI.SET_SEARCH_OPEN, open}),
				setShortcutsOpen: (open) =>
					set({shortcutsOpen: open}, false, {type: STORE_ACTION.UI.SET_SHORTCUTS_OPEN, open}),
				setShowOutline: (show) =>
					set({showOutline: show}, false, {type: STORE_ACTION.UI.SET_SHOW_OUTLINE, show}),
				setAllToolsExpanded: (expanded) =>
					set({allToolsExpanded: expanded}, false, {type: STORE_ACTION.UI.SET_ALL_TOOLS_EXPANDED, expanded}),
				setDrilldownAgentId: (id) =>
					set({drilldownAgentId: id}, false, {type: STORE_ACTION.UI.SET_DRILLDOWN_AGENT_ID, id}),
			})),
			{
				name: STORE_PERSIST_KEY[STORE_KEY.UI],
				partialize: (state) => ({
					showOutline: state.showOutline,
					allToolsExpanded: state.allToolsExpanded,
				}),
			},
		),
		{
			name: STORE_DEVTOOLS_NAME[STORE_KEY.UI],
		},
	),
)
