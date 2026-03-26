import {createClientLogger} from "../../lib/log/client"
import {LOG_MESSAGE, STORE_LOG_MODULE, type StoreKey} from "../../lib/event-catalog"
import type {StateCreator, StoreMutatorIdentifier} from "zustand"

const MAX_ARRAY_PREVIEW_ITEMS = 8
const MAX_MAP_PREVIEW_ENTRIES = 8
const MAX_SET_PREVIEW_ITEMS = 8
const MAX_OBJECT_PREVIEW_KEYS = 12
const MAX_STRING_PREVIEW_LENGTH = 200
const MAX_PREVIEW_DEPTH = 2

function shallowChangedKeys<T extends object>(prevState: T, nextState: T): string[] {
	const changed: string[] = []
	const prev = prevState as Record<string, unknown>
	const next = nextState as Record<string, unknown>
	const keys = new Set([...Object.keys(prev), ...Object.keys(next)])

	for (const key of keys) {
		if (!Object.is(prev[key], next[key])) changed.push(key)
	}

	return changed
}

function toLogValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
	if (value === null) return null
	if (typeof value === "string") {
		return value.length > MAX_STRING_PREVIEW_LENGTH
			? `${value.slice(0, MAX_STRING_PREVIEW_LENGTH)}...`
			: value
	}
	if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return value
	if (typeof value === "undefined") return "undefined"
	if (typeof value === "function") return "[function]"
	if (value instanceof Date) return value.toISOString()

	if (depth >= MAX_PREVIEW_DEPTH) {
		if (Array.isArray(value)) return `[array:${value.length}]`
		if (value instanceof Set) return `[set:${value.size}]`
		if (value instanceof Map) return `[map:${value.size}]`
		if (typeof value === "object") return "[object]"
	}

	if (Array.isArray(value)) {
		return {
			type: "array",
			length: value.length,
			items: value.slice(0, MAX_ARRAY_PREVIEW_ITEMS).map((item) => toLogValue(item, depth + 1, seen)),
		}
	}

	if (value instanceof Set) {
		return {
			type: "set",
			size: value.size,
			values: [...value].slice(0, MAX_SET_PREVIEW_ITEMS).map((item) => toLogValue(item, depth + 1, seen)),
		}
	}

	if (value instanceof Map) {
		return {
			type: "map",
			size: value.size,
			entries: [...value.entries()]
				.slice(0, MAX_MAP_PREVIEW_ENTRIES)
				.map(([key, item]) => [toLogValue(key, depth + 1, seen), toLogValue(item, depth + 1, seen)]),
		}
	}

	if (typeof value === "object") {
		if (seen.has(value)) return "[circular]"
		seen.add(value)

		const entries = Object.entries(value).slice(0, MAX_OBJECT_PREVIEW_KEYS)
		const preview: Record<string, unknown> = {}
		for (const [key, item] of entries) {
			preview[key] = toLogValue(item, depth + 1, seen)
		}
		if (Object.keys(value).length > MAX_OBJECT_PREVIEW_KEYS) {
			preview.__truncated = Object.keys(value).length - MAX_OBJECT_PREVIEW_KEYS
		}
		return preview
	}

	return String(value)
}

function changedStatePreview<T extends object>(state: T, changedKeys: string[]): Record<string, unknown> {
	const next = state as Record<string, unknown>
	const preview: Record<string, unknown> = {}
	for (const key of changedKeys) {
		preview[key] = toLogValue(next[key])
	}
	return preview
}

function normalizeAction(action: unknown): string | undefined {
	if (typeof action === "string") return action
	if (typeof action === "object" && action !== null && "type" in action) {
		const type = (action as {type?: unknown}).type
		return typeof type === "string" ? type : undefined
	}
	return undefined
}

export function withStoreLogging<
	T extends object,
	Mps extends [StoreMutatorIdentifier, unknown][] = [],
	Mcs extends [StoreMutatorIdentifier, unknown][] = [],
	U = T,
>(store: StoreKey, config: StateCreator<T, Mps, Mcs, U>): StateCreator<T, Mps, Mcs, U> {
	const log = createClientLogger(STORE_LOG_MODULE[store])

	return (set, get, api) =>
		config(
			((...setArgs: unknown[]) => {
				const prevState = get()
				;(set as (...args: unknown[]) => void)(...setArgs)
				const nextState = get()
				const changedKeys = shallowChangedKeys(prevState, nextState)
				if (changedKeys.length === 0) return
				const action = normalizeAction(setArgs[2])

				log.info(LOG_MESSAGE.STORE_STATE_CHANGED, {
					store,
					action,
					changedKeys,
					nextState: changedStatePreview(nextState, changedKeys),
				})
			}) as typeof set,
			get,
			api,
		)
}
