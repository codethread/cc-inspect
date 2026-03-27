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
	allAgentsExpanded: boolean
	drilldownAgentId: string | null
	detailRawView: boolean
	setFilterOpen: (open: boolean) => void
	setSearchOpen: (open: boolean) => void
	setShortcutsOpen: (open: boolean) => void
	setShowOutline: (show: boolean) => void
	setAllToolsExpanded: (expanded: boolean) => void
	setAllAgentsExpanded: (expanded: boolean) => void
	setDrilldownAgentId: (id: string | null) => void
	setDetailRawView: (raw: boolean) => void
}

export const useUIStore = create<UIState>()(
	devtools(
		persist(
			withStoreLogging(STORE_KEY.UI, (set) => ({
				filterOpen: false,
				searchOpen: false,
				shortcutsOpen: false,
				showOutline: true,
				allToolsExpanded: false,
				allAgentsExpanded: false,
				drilldownAgentId: null,
				detailRawView: false,
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
				setAllAgentsExpanded: (expanded) =>
					set({allAgentsExpanded: expanded}, false, {type: STORE_ACTION.UI.SET_ALL_AGENTS_EXPANDED, expanded}),
				setDrilldownAgentId: (id) =>
					set({drilldownAgentId: id}, false, {type: STORE_ACTION.UI.SET_DRILLDOWN_AGENT_ID, id}),
				setDetailRawView: (raw) =>
					set({detailRawView: raw}, false, {type: STORE_ACTION.UI.SET_DETAIL_RAW_VIEW, raw}),
			})),
			{
				name: STORE_PERSIST_KEY[STORE_KEY.UI],
				partialize: (state) => ({
					showOutline: state.showOutline,
					allToolsExpanded: state.allToolsExpanded,
					allAgentsExpanded: state.allAgentsExpanded,
					detailRawView: state.detailRawView,
				}),
			},
		),
		{
			name: STORE_DEVTOOLS_NAME[STORE_KEY.UI],
		},
	),
)
