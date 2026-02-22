import {create} from "zustand"
import {persist} from "zustand/middleware"

export const SCOPES = {
	/** Always active — app-wide configurable shortcuts */
	GLOBAL: "global",
	/** Active when a full-screen modal overlay is open; disables GLOBAL to prevent conflicts */
	MODAL: "modal",
} as const

/** Passed to HotkeysProvider as `initiallyActiveScopes`. Modal scope is activated dynamically. */
export const INITIAL_ACTIVE_SCOPES = [SCOPES.GLOBAL]

export interface KeybindingDef {
	id: string
	label: string
	description: string
	defaultKeys: string
	scope: (typeof SCOPES)[keyof typeof SCOPES]
	configurable: boolean
}

export const DEFAULT_BINDINGS: Record<string, KeybindingDef> = {
	"search.open": {
		id: "search.open",
		label: "Open search",
		description: "Open the full-text event search modal",
		defaultKeys: "mod+k",
		scope: SCOPES.GLOBAL,
		configurable: true,
	},
	"outline.toggle": {
		id: "outline.toggle",
		label: "Toggle outline",
		description: "Show or hide the left outline sidebar",
		defaultKeys: "mod+shift+o",
		scope: SCOPES.GLOBAL,
		configurable: true,
	},
	"filter.open": {
		id: "filter.open",
		label: "Open filters",
		description: "Open the filter drawer",
		defaultKeys: "mod+shift+f",
		scope: SCOPES.GLOBAL,
		configurable: true,
	},
	"tools.toggle": {
		id: "tools.toggle",
		label: "Toggle tool calls",
		description: "Collapse or expand all tool call groups",
		defaultKeys: "mod+shift+t",
		scope: SCOPES.GLOBAL,
		configurable: true,
	},
}

export const CONFIGURABLE_BINDINGS = Object.values(DEFAULT_BINDINGS).filter((b) => b.configurable)

interface KeybindingsState {
	/** Only user-overridden keys are stored; unset = use default */
	customKeys: Record<string, string>
	/** Resolve effective keys for a binding: custom override or default */
	getKeys: (id: string) => string
	updateBinding: (id: string, keys: string) => void
	resetBinding: (id: string) => void
	resetAll: () => void
}

export const useKeybindingsStore = create<KeybindingsState>()(
	persist(
		(set, get) => ({
			customKeys: {},
			getKeys: (id) => get().customKeys[id] ?? DEFAULT_BINDINGS[id]?.defaultKeys ?? "",
			updateBinding: (id, keys) => set((state) => ({customKeys: {...state.customKeys, [id]: keys}})),
			resetBinding: (id) =>
				set((state) => {
					// biome-ignore lint/correctness/noUnusedVariables: destructure to omit id
					const {[id]: _removed, ...rest} = state.customKeys
					return {customKeys: rest}
				}),
			resetAll: () => set({customKeys: {}}),
		}),
		{
			name: "cc-inspect-keybindings",
			// Persist only the user's overrides, not the full binding metadata
			partialize: (state) => ({customKeys: state.customKeys}),
		},
	),
)

// ---------------------------------------------------------------------------
// Display utilities
// ---------------------------------------------------------------------------

const isMac =
	typeof navigator !== "undefined" &&
	(navigator.platform.toLowerCase().includes("mac") || /Mac/.test(navigator.userAgent))

/** Convert a react-hotkeys-hook keys string to a human-readable label. */
export function formatHotkey(keys: string): string {
	// Take the first alternative (before comma)
	return keys
		.split(",")[0]
		.trim()
		.split("+")
		.map((k) => {
			switch (k.trim().toLowerCase()) {
				case "mod":
					return isMac ? "⌘" : "Ctrl"
				case "meta":
					return "⌘"
				case "ctrl":
					return "Ctrl"
				case "shift":
					return "⇧"
				case "alt":
					return isMac ? "⌥" : "Alt"
				case "escape":
					return "Esc"
				case "arrowup":
					return "↑"
				case "arrowdown":
					return "↓"
				case "enter":
					return "↵"
				default:
					return k.toUpperCase()
			}
		})
		.join(" ")
}

/** Convert a Set of raw browser key names (from useRecordHotkeys) to a hotkeys binding string. */
export function recordedKeysToBinding(keys: Set<string>): string {
	const parts = Array.from(keys).map((k) => {
		switch (k) {
			case "Meta":
				return "mod"
			case "Control":
				return "mod"
			case "Shift":
				return "shift"
			case "Alt":
				return "alt"
			default:
				return k.toLowerCase()
		}
	})
	// Deduplicate (Meta + Control both map to 'mod')
	const unique = [...new Set(parts)]
	// Sort modifiers before regular keys
	const modOrder = ["mod", "ctrl", "shift", "alt"]
	unique.sort((a, b) => {
		const ai = modOrder.indexOf(a)
		const bi = modOrder.indexOf(b)
		if (ai !== -1 && bi === -1) return -1
		if (ai === -1 && bi !== -1) return 1
		return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
	})
	return unique.join("+")
}

/** Display a Set of live-recorded keys during capture (e.g. while user holds keys). */
export function formatRecordedKeys(keys: Set<string>): string {
	return Array.from(keys)
		.map((k) => {
			switch (k) {
				case "Meta":
					return isMac ? "⌘" : "Win"
				case "Control":
					return "Ctrl"
				case "Shift":
					return "⇧"
				case "Alt":
					return isMac ? "⌥" : "Alt"
				case "Escape":
					return "Esc"
				default:
					return k.toUpperCase()
			}
		})
		.join(" + ")
}
