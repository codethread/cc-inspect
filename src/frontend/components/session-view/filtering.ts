import type {Event, EventType} from "#types"
import {SESSION_EVENT_TYPE} from "../../../lib/event-catalog"
import {getEventSearchableText} from "./helpers"

export interface FilterCriteria {
	search: string
	typeInclude: Set<EventType>
	typeExclude: Set<EventType>
	agentFilter: Set<string>
	errorsOnly: boolean
	failedToolUseIds: Set<string>
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
	if (criteria.search) {
		const q = criteria.search.toLowerCase()
		if (!getEventSearchableText(event).includes(q)) return false
	}
	return true
}
