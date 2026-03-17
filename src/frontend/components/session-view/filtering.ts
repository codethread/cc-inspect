import type {Event, EventType} from "#types"
import {SESSION_EVENT_TYPE} from "../../../lib/event-catalog"
import {getEventSearchableText, normalizeModelFamily} from "./helpers"

export interface FilterCriteria {
	search: string
	typeInclude: Set<EventType>
	typeExclude: Set<EventType>
	agentFilter: Set<string>
	modelFilter: Set<string>
	errorsOnly: boolean
	failedToolUseIds: Set<string>
	agentModelMap: Map<string, string>
}

function resolveEventModel(event: Event, agentModelMap: Map<string, string>): string | null {
	const data = event.data
	if ("model" in data && data.model) {
		return normalizeModelFamily(data.model as string)
	}
	return agentModelMap.get(event.agentId ?? "") ?? null
}

export function matchesFilters(event: Event, criteria: FilterCriteria): boolean {
	if (criteria.errorsOnly) {
		const isFailedResult = event.data.type === SESSION_EVENT_TYPE.TOOL_RESULT && !event.data.success
		const isLinkedToolUse =
			event.data.type === SESSION_EVENT_TYPE.TOOL_USE && criteria.failedToolUseIds.has(event.data.toolId)
		if (!isFailedResult && !isLinkedToolUse) return false
	}
	if (criteria.typeInclude.size > 0 && !criteria.typeInclude.has(event.type)) return false
	if (criteria.typeExclude.has(event.type)) return false
	if (criteria.agentFilter.size > 0 && !criteria.agentFilter.has(event.agentId ?? "")) return false
	if (criteria.modelFilter.size > 0) {
		const model = resolveEventModel(event, criteria.agentModelMap)
		if (!model || !criteria.modelFilter.has(model)) return false
	}
	if (criteria.search) {
		const q = criteria.search.toLowerCase()
		if (!getEventSearchableText(event).includes(q)) return false
	}
	return true
}
