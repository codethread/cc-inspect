export const CLAUDE_LOG_ENTRY_TYPE = {
	USER: "user",
	ASSISTANT: "assistant",
	SUMMARY: "summary",
} as const

export const CLAUDE_CONTENT_TYPE = {
	TEXT: "text",
	THINKING: "thinking",
	TOOL_USE: "tool_use",
	TOOL_RESULT: "tool_result",
} as const

export const SESSION_EVENT_TYPE = {
	USER_MESSAGE: "user-message",
	ASSISTANT_MESSAGE: "assistant-message",
	TOOL_USE: "tool-use",
	TOOL_RESULT: "tool-result",
	THINKING: "thinking",
	AGENT_SPAWN: "agent-spawn",
	SUMMARY: "summary",
} as const

export const SESSION_EVENT_TYPE_VALUES = [
	SESSION_EVENT_TYPE.USER_MESSAGE,
	SESSION_EVENT_TYPE.ASSISTANT_MESSAGE,
	SESSION_EVENT_TYPE.TOOL_USE,
	SESSION_EVENT_TYPE.TOOL_RESULT,
	SESSION_EVENT_TYPE.THINKING,
	SESSION_EVENT_TYPE.AGENT_SPAWN,
	SESSION_EVENT_TYPE.SUMMARY,
] as const

export const STORE_KEY = {
	UI: "ui",
	FILTER: "filter",
	KEYBINDINGS: "keybindings",
	SELECTION: "selection",
	ACCORDION: "accordion",
	PICKER: "picker",
} as const

export type StoreKey = (typeof STORE_KEY)[keyof typeof STORE_KEY]

export const STORE_LOG_MODULE = {
	[STORE_KEY.UI]: "store.ui",
	[STORE_KEY.FILTER]: "store.filter",
	[STORE_KEY.KEYBINDINGS]: "store.keybindings",
	[STORE_KEY.SELECTION]: "store.selection",
	[STORE_KEY.ACCORDION]: "store.accordion",
	[STORE_KEY.PICKER]: "store.picker",
} as const satisfies Record<StoreKey, string>

export const STORE_DEVTOOLS_NAME = {
	[STORE_KEY.UI]: "cc-inspect/ui",
	[STORE_KEY.FILTER]: "cc-inspect/filter",
	[STORE_KEY.KEYBINDINGS]: "cc-inspect/keybindings",
	[STORE_KEY.SELECTION]: "cc-inspect/selection",
	[STORE_KEY.ACCORDION]: "cc-inspect/accordion",
	[STORE_KEY.PICKER]: "cc-inspect/picker",
} as const satisfies Record<StoreKey, string>

export const STORE_PERSIST_KEY = {
	[STORE_KEY.UI]: "cc-inspect-ui",
	[STORE_KEY.FILTER]: "cc-inspect-filter-event-types",
	[STORE_KEY.KEYBINDINGS]: "cc-inspect-keybindings",
} as const

export const STORE_ACTION = {
	UI: {
		SET_FILTER_OPEN: "ui/setFilterOpen",
		SET_SEARCH_OPEN: "ui/setSearchOpen",
		SET_SHORTCUTS_OPEN: "ui/setShortcutsOpen",
		SET_SHOW_OUTLINE: "ui/setShowOutline",
		SET_ALL_TOOLS_EXPANDED: "ui/setAllToolsExpanded",
	},
	FILTER: {
		SET_SEARCH: "filter/setSearch",
		SET_TYPE_INCLUDE: "filter/setTypeInclude",
		SET_TYPE_EXCLUDE: "filter/setTypeExclude",
		SET_AGENT_FILTER: "filter/setAgentFilter",
		SET_ERRORS_ONLY: "filter/setErrorsOnly",
		CLEAR_FILTERS: "filter/clearFilters",
	},
	KEYBINDINGS: {
		UPDATE_BINDING: "keybindings/updateBinding",
		RESET_BINDING: "keybindings/resetBinding",
		RESET_ALL: "keybindings/resetAll",
	},
	SELECTION: {
		SET_SELECTED_EVENT: "selection/setSelectedEvent",
		SET_ACTIVE_TURN_ID: "selection/setActiveTurnId",
	},
	ACCORDION: {
		SET_EXPANDED: "accordion/setExpanded",
		RESET_ALL: "accordion/resetAll",
	},
	PICKER: {
		SET_OPEN: "picker/setOpen",
		SET_DIR: "picker/setDir",
	},
} as const

export const LOG_MODULE = {
	SERVER: "server",
	ROUTES_SESSION: "routes.session",
	ROUTES_SESSION_DELETE: "routes.session-delete",
	ROUTES_LOG: "routes.log",
	APP: "app",
	API: "api",
} as const

export const LOG_MESSAGE = {
	APP_STARTED: "app.started",
	API_ERROR: "api.error",
	STORE_STATE_CHANGED: "store.state.changed",
	SERVER_VALIDATING_SESSION_LOGS: "server.session.validation.started",
	SERVER_SESSION_VALIDATED: "server.session.validation.succeeded",
	SERVER_FAILED_TO_PARSE_SESSION_LOGS: "server.session.validation.failed",
	SERVER_STARTED: "server.started",
	ROUTE_LOG_BEACON_FAILED: "routes.log.beacon.failed",
	ROUTE_SESSION_PARSED: "routes.session.parsed",
	ROUTE_SESSION_LOADED: "routes.session.loaded",
	ROUTE_SESSION_PARSE_ERROR: "routes.session.parse.error",
	ROUTE_SESSION_FAILED_TO_PARSE: "routes.session.parse.failed",
	ROUTE_SESSION_DELETE_FILE: "routes.session-delete.file",
	ROUTE_SESSION_DELETE_FOLDER: "routes.session-delete.folder",
	ROUTE_SESSION_DELETE_FOLDER_MISSING: "routes.session-delete.folder.missing",
	ROUTE_SESSION_DELETED: "routes.session-delete.completed",
	ROUTE_SESSION_DELETE_FAILED: "routes.session-delete.failed",
} as const
