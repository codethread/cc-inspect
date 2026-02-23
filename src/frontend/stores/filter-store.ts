import {create} from "zustand"
import {createJSONStorage, persist} from "zustand/middleware"
import type {EventType} from "#types"

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

const EVENT_TYPE_VALUES: EventType[] = [
	"user-message",
	"assistant-message",
	"tool-use",
	"tool-result",
	"thinking",
	"agent-spawn",
	"summary",
]

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
	persist(
		(set) => ({
			search: "",
			typeInclude: new Set<EventType>(),
			typeExclude: new Set<EventType>(),
			agentFilter: new Set<string>(),
			errorsOnly: false,
			errorsOnlyToolUseWasExcluded: false,
			errorsOnlyToolUseWasMissingFromInclude: false,
			setSearch: (search) => set({search}),
			setTypeInclude: (typeInclude) => set({typeInclude}),
			setTypeExclude: (typeExclude) => set({typeExclude}),
			setAgentFilter: (agentFilter) => set({agentFilter}),
			setErrorsOnly: (errorsOnly) =>
				set((state) => {
					if (errorsOnly === state.errorsOnly) return {}

					const nextTypeInclude = new Set(state.typeInclude)
					const nextTypeExclude = new Set(state.typeExclude)

					if (errorsOnly) {
						const toolUseWasExcluded = nextTypeExclude.delete("tool-use")
						const toolUseWasMissingFromInclude = nextTypeInclude.size > 0 && !nextTypeInclude.has("tool-use")

						if (toolUseWasMissingFromInclude) {
							nextTypeInclude.add("tool-use")
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
						nextTypeExclude.add("tool-use")
					}
					if (state.errorsOnlyToolUseWasMissingFromInclude) {
						nextTypeInclude.delete("tool-use")
					}

					return {
						errorsOnly: false,
						typeInclude: nextTypeInclude,
						typeExclude: nextTypeExclude,
						errorsOnlyToolUseWasExcluded: false,
						errorsOnlyToolUseWasMissingFromInclude: false,
					}
				}),
			clearFilters: () =>
				set({
					search: "",
					typeInclude: new Set<EventType>(),
					typeExclude: new Set<EventType>(),
					agentFilter: new Set<string>(),
					errorsOnly: false,
					errorsOnlyToolUseWasExcluded: false,
					errorsOnlyToolUseWasMissingFromInclude: false,
				}),
		}),
		{
			name: "cc-inspect-filter-event-types",
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
)
