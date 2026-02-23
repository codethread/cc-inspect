import {create} from "zustand"
import {createJSONStorage, devtools, persist} from "zustand/middleware"
import type {EventType} from "#types"
import {
	SESSION_EVENT_TYPE,
	SESSION_EVENT_TYPE_VALUES,
	STORE_ACTION,
	STORE_DEVTOOLS_NAME,
	STORE_KEY,
	STORE_PERSIST_KEY,
} from "../../lib/event-catalog"
import {withStoreLogging} from "./store-logging-middleware"

interface FilterState {
	search: string
	typeInclude: Set<EventType>
	typeExclude: Set<EventType>
	agentFilter: Set<string>
	errorsOnly: boolean
	errorsOnlyToolUseWasExcluded: boolean
	errorsOnlyToolUseWasMissingFromInclude: boolean
	setSearch: (s: string) => void
	setTypeInclude: (s: Set<EventType>) => void
	setTypeExclude: (s: Set<EventType>) => void
	setAgentFilter: (s: Set<string>) => void
	setErrorsOnly: (v: boolean) => void
	clearFilters: () => void
}

const EVENT_TYPE_VALUES: EventType[] = [...SESSION_EVENT_TYPE_VALUES]

const eventTypeValueSet = new Set<EventType>(EVENT_TYPE_VALUES)

interface SerializedSet {
	__type: "set"
	values: unknown[]
}

function isSerializedSet(value: unknown): value is SerializedSet {
	if (typeof value !== "object" || value === null) return false
	if (!("__type" in value) || !("values" in value)) return false
	return (value as {__type: unknown}).__type === "set" && Array.isArray((value as {values: unknown[]}).values)
}

function reviveEventTypeSet(value: unknown): unknown {
	if (!isSerializedSet(value)) return value

	const next = new Set<EventType>()
	for (const item of value.values) {
		if (typeof item !== "string") continue
		if (eventTypeValueSet.has(item as EventType)) next.add(item as EventType)
	}
	return next
}

export const useFilterStore = create<FilterState>()(
	devtools(
		persist(
			withStoreLogging(STORE_KEY.FILTER, (set) => ({
				search: "",
				typeInclude: new Set<EventType>(),
				typeExclude: new Set<EventType>(),
				agentFilter: new Set<string>(),
				errorsOnly: false,
				errorsOnlyToolUseWasExcluded: false,
				errorsOnlyToolUseWasMissingFromInclude: false,
				setSearch: (search) =>
					set({search}, false, {type: STORE_ACTION.FILTER.SET_SEARCH, search}),
				setTypeInclude: (typeInclude) =>
					set({typeInclude}, false, {type: STORE_ACTION.FILTER.SET_TYPE_INCLUDE}),
				setTypeExclude: (typeExclude) =>
					set({typeExclude}, false, {type: STORE_ACTION.FILTER.SET_TYPE_EXCLUDE}),
				setAgentFilter: (agentFilter) =>
					set({agentFilter}, false, {type: STORE_ACTION.FILTER.SET_AGENT_FILTER}),
				setErrorsOnly: (errorsOnly) =>
					set((state) => {
						if (errorsOnly === state.errorsOnly) return {}

						const nextTypeInclude = new Set(state.typeInclude)
						const nextTypeExclude = new Set(state.typeExclude)

						if (errorsOnly) {
							const toolUseWasExcluded = nextTypeExclude.delete(SESSION_EVENT_TYPE.TOOL_USE)
							const toolUseWasMissingFromInclude =
								nextTypeInclude.size > 0 && !nextTypeInclude.has(SESSION_EVENT_TYPE.TOOL_USE)

							if (toolUseWasMissingFromInclude) {
								nextTypeInclude.add(SESSION_EVENT_TYPE.TOOL_USE)
							}

							return {
								errorsOnly: true,
								typeInclude: nextTypeInclude,
								typeExclude: nextTypeExclude,
								errorsOnlyToolUseWasExcluded: toolUseWasExcluded,
								errorsOnlyToolUseWasMissingFromInclude: toolUseWasMissingFromInclude,
							}
						}

						if (state.errorsOnlyToolUseWasExcluded) {
							nextTypeExclude.add(SESSION_EVENT_TYPE.TOOL_USE)
						}
						if (state.errorsOnlyToolUseWasMissingFromInclude) {
							nextTypeInclude.delete(SESSION_EVENT_TYPE.TOOL_USE)
						}

						return {
							errorsOnly: false,
							typeInclude: nextTypeInclude,
							typeExclude: nextTypeExclude,
							errorsOnlyToolUseWasExcluded: false,
							errorsOnlyToolUseWasMissingFromInclude: false,
						}
					}, false, {type: STORE_ACTION.FILTER.SET_ERRORS_ONLY, errorsOnly}),
				clearFilters: () =>
					set({
						search: "",
						typeInclude: new Set<EventType>(),
						typeExclude: new Set<EventType>(),
						agentFilter: new Set<string>(),
						errorsOnly: false,
						errorsOnlyToolUseWasExcluded: false,
						errorsOnlyToolUseWasMissingFromInclude: false,
					}, false, {type: STORE_ACTION.FILTER.CLEAR_FILTERS}),
			})),
			{
				name: STORE_PERSIST_KEY[STORE_KEY.FILTER],
				partialize: (state) => ({
					typeInclude: state.typeInclude,
					typeExclude: state.typeExclude,
				}),
				storage: createJSONStorage(() => localStorage, {
					replacer: (_key, value) => (value instanceof Set ? {__type: "set", values: [...value]} : value),
					reviver: (_key, value) => reviveEventTypeSet(value),
				}),
				merge: (persistedState, currentState) => {
					const persisted = persistedState as Partial<{
						typeInclude: Set<EventType>
						typeExclude: Set<EventType>
					}>
					return {
						...currentState,
						typeInclude: persisted.typeInclude ?? currentState.typeInclude,
						typeExclude: persisted.typeExclude ?? currentState.typeExclude,
					}
				},
			},
		),
		{
			name: STORE_DEVTOOLS_NAME[STORE_KEY.FILTER],
		},
	),
)
