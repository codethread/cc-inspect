import {create} from "zustand"
import {devtools} from "zustand/middleware"
import type {AgentNode, Event, SessionData, TailServerMessage} from "#types"
import {LOG_MESSAGE, LOG_MODULE, STORE_ACTION, STORE_DEVTOOLS_NAME, STORE_KEY} from "../../lib/event-catalog"
import {createClientLogger} from "../../lib/log/client"
import {rehydrateAgent, rehydrateEvent, rehydrateSessionData} from "../api"
import {withStoreLogging} from "./store-logging-middleware"

const log = createClientLogger(LOG_MODULE.STORE_TAIL)

function getWsUrl(path: string): string {
	const proto = location.protocol === "https:" ? "wss:" : "ws:"
	return `${proto}//${location.host}${path}`
}

// ---------------------------------------------------------------------------
// Connection state machine types
// ---------------------------------------------------------------------------

export type TailConnection =
	| {status: "disconnected"}
	| {status: "connecting"; path: string; ws: WebSocket; lastSeq: number; attempt: number}
	| {status: "connected"; path: string; ws: WebSocket; lastSeq: number}
	| {status: "reconnecting"; path: string; lastSeq: number; attempt: number}

export type TailConnectionEvent =
	| {type: "start"; path: string; ws: WebSocket}
	| {type: "ws_open"}
	| {type: "ws_message"; lastSeq: number}
	| {type: "ws_close"}
	| {type: "ws_error"}
	| {type: "reconnect_tick"; ws: WebSocket}
	| {type: "max_retries"}
	| {type: "stop"}

export type TailConnectionEffect =
	| {type: "send_subscribe"; ws: WebSocket; path: string; resumeAfterSeq?: number}
	| {type: "close_ws"; ws: WebSocket}
	| {type: "schedule_reconnect"; attempt: number; path: string; lastSeq: number}
	| {type: "cancel_reconnect"}

// ---------------------------------------------------------------------------
// Pure transition function
// ---------------------------------------------------------------------------

export function tailConnectionTransition(
	state: TailConnection,
	event: TailConnectionEvent,
): {state: TailConnection; effects: TailConnectionEffect[]} {
	switch (state.status) {
		case "disconnected": {
			if (event.type === "start") {
				return {
					state: {status: "connecting", path: event.path, ws: event.ws, lastSeq: 0, attempt: 0},
					effects: [],
				}
			}
			return {state, effects: []}
		}

		case "connecting": {
			switch (event.type) {
				case "ws_open":
					return {
						state: {status: "connected", path: state.path, ws: state.ws, lastSeq: state.lastSeq},
						effects: [
							{
								type: "send_subscribe",
								ws: state.ws,
								path: state.path,
								resumeAfterSeq: state.lastSeq > 0 ? state.lastSeq : undefined,
							},
						],
					}
				case "ws_error":
				case "ws_close": {
					const nextAttempt = state.attempt + 1
					return {
						state: {status: "reconnecting", path: state.path, lastSeq: state.lastSeq, attempt: nextAttempt},
						effects: [
							{
								type: "schedule_reconnect",
								attempt: nextAttempt,
								path: state.path,
								lastSeq: state.lastSeq,
							},
						],
					}
				}
				case "stop":
					return {
						state: {status: "disconnected"},
						effects: [{type: "close_ws", ws: state.ws}],
					}
				default:
					return {state, effects: []}
			}
		}

		case "connected": {
			switch (event.type) {
				case "ws_message":
					return {
						state: {...state, lastSeq: event.lastSeq},
						effects: [],
					}
				case "ws_close":
				case "ws_error":
					return {
						state: {status: "reconnecting", path: state.path, lastSeq: state.lastSeq, attempt: 1},
						effects: [{type: "schedule_reconnect", attempt: 1, path: state.path, lastSeq: state.lastSeq}],
					}
				case "stop":
					return {
						state: {status: "disconnected"},
						effects: [{type: "close_ws", ws: state.ws}],
					}
				default:
					return {state, effects: []}
			}
		}

		case "reconnecting": {
			switch (event.type) {
				case "reconnect_tick":
					return {
						state: {
							status: "connecting",
							path: state.path,
							ws: event.ws,
							lastSeq: state.lastSeq,
							attempt: state.attempt,
						},
						effects: [],
					}
				case "max_retries":
					return {
						state: {status: "disconnected"},
						effects: [],
					}
				case "stop":
					return {
						state: {status: "disconnected"},
						effects: [{type: "cancel_reconnect"}],
					}
				default:
					return {state, effects: []}
			}
		}
	}
}

// ---------------------------------------------------------------------------
// mergeEvents helper (pure)
// ---------------------------------------------------------------------------

function mergeEvents(
	state: Pick<TailState, "sessionData" | "autoScroll" | "newEventCount">,
	msg: {events: Event[]; agents: AgentNode[]; seq: number},
): Partial<TailState> {
	if (!state.sessionData) return {}

	const rehydratedEvents = msg.events.map(rehydrateEvent)
	const rehydratedAgents = msg.agents.map(rehydrateAgent)

	// Deduplicate by event.id
	const existingIds = new Set(state.sessionData.allEvents.map((e) => e.id))
	const newEvents = rehydratedEvents.filter((e) => !existingIds.has(e.id))

	if (newEvents.length === 0 && rehydratedAgents.length === 0) return {}

	// Merge events into allEvents maintaining timestamp sort (event ID as tie-breaker)
	const allEvents = [...state.sessionData.allEvents, ...newEvents].sort(
		(a, b) => a.timestamp.getTime() - b.timestamp.getTime() || a.id.localeCompare(b.id),
	)

	// Add new agents and apply metadata updates for existing agents (e.g. stale early-discovery name)
	const existingAgentIds = new Set(state.sessionData.mainAgent.children.map((c: AgentNode) => c.id))
	const updatedAgents = new Map<string, AgentNode>(
		rehydratedAgents.filter((a) => existingAgentIds.has(a.id)).map((a) => [a.id, a]),
	)
	const newAgents = rehydratedAgents.filter((a) => !existingAgentIds.has(a.id))
	const children = [
		...state.sessionData.mainAgent.children.map((c: AgentNode) => {
			const update = updatedAgents.get(c.id)
			// Merge refreshed metadata fields while preserving accumulated events/children
			return update
				? {
						...c,
						name: update.name,
						model: update.model,
						description: update.description,
						subagentType: update.subagentType,
					}
				: c
		}),
		...newAgents,
	]

	// Also merge events into agent nodes
	const mainAgent: AgentNode = {
		...state.sessionData.mainAgent,
		children,
		events: allEvents.filter((e) => e.agentId === state.sessionData?.sessionId || e.agentId === null),
	}

	// Update agent-specific events
	for (const child of mainAgent.children) {
		child.events = allEvents.filter((e) => e.agentId === child.id)
	}

	const sessionData: SessionData = {
		...state.sessionData,
		mainAgent,
		allEvents,
	}

	// Increment newEventCount if not auto-scrolling
	const newEventCount = state.autoScroll ? 0 : state.newEventCount + newEvents.length

	return {sessionData, newEventCount}
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface TailState {
	connection: TailConnection
	sessionData: SessionData | null
	isIdle: boolean
	autoScroll: boolean
	newEventCount: number

	startTailing: (path: string) => void
	stopTailing: () => void
	setAutoScroll: (v: boolean) => void
	resetNewEventCount: () => void
}

export const useTailStore = create<TailState>()(
	devtools(
		withStoreLogging(STORE_KEY.TAIL, (set, get) => {
			let reconnectTimer: Timer | null = null

			function dispatch(event: TailConnectionEvent): void {
				const current = get().connection
				const result = tailConnectionTransition(current, event)
				set({connection: result.state}, false, {type: STORE_ACTION.TAIL.DISPATCH, event: event.type})

				for (const effect of result.effects) {
					executeEffect(effect)
				}
			}

			function executeEffect(effect: TailConnectionEffect): void {
				switch (effect.type) {
					case "send_subscribe":
						try {
							const payload: Record<string, unknown> = {path: effect.path}
							if (effect.resumeAfterSeq !== undefined) {
								payload.resumeAfterSeq = effect.resumeAfterSeq
							}
							effect.ws.send(JSON.stringify(payload))
						} catch {
							dispatch({type: "ws_error"})
						}
						break
					case "close_ws":
						try {
							effect.ws.close()
						} catch {
							/* already closed */
						}
						break
					case "schedule_reconnect": {
						if (effect.attempt >= 10) {
							dispatch({type: "max_retries"})
							return
						}
						const backoff = Math.min(100 * 2 ** effect.attempt, 5000)
						log.info(LOG_MESSAGE.TAIL_STORE_RECONNECT_ATTEMPT, {attempt: effect.attempt, backoff})
						reconnectTimer = setTimeout(() => {
							const ws = new WebSocket(getWsUrl("/ws/session/tail"))
							ws.onopen = () => dispatch({type: "ws_open"})
							ws.onclose = () => dispatch({type: "ws_close"})
							ws.onerror = () => dispatch({type: "ws_error"})
							ws.onmessage = (e) => handleMessage(JSON.parse(e.data))
							dispatch({type: "reconnect_tick", ws})
						}, backoff)
						break
					}
					case "cancel_reconnect":
						if (reconnectTimer) {
							clearTimeout(reconnectTimer)
							reconnectTimer = null
						}
						break
				}
			}

			function handleMessage(msg: TailServerMessage): void {
				switch (msg.type) {
					case "snapshot":
						set({sessionData: rehydrateSessionData(msg.data), isIdle: false}, false, {
							type: STORE_ACTION.TAIL.DISPATCH,
							event: "snapshot",
						})
						dispatch({type: "ws_message", lastSeq: msg.seq})
						log.info(LOG_MESSAGE.TAIL_STORE_SNAPSHOT_RECEIVED, {events: msg.data.allEvents.length})
						break
					case "events":
						set((state) => mergeEvents(state, msg), false, {
							type: STORE_ACTION.TAIL.DISPATCH,
							event: "events",
						})
						dispatch({type: "ws_message", lastSeq: msg.seq})
						log.info(LOG_MESSAGE.TAIL_STORE_EVENTS_MERGED, {
							events: msg.events.length,
							agents: msg.agents.length,
						})
						break
					case "heartbeat":
						dispatch({type: "ws_message", lastSeq: msg.seq})
						break
					case "idle":
						set({isIdle: true}, false, {type: STORE_ACTION.TAIL.DISPATCH, event: "idle"})
						dispatch({type: "ws_message", lastSeq: msg.seq})
						break
					case "active":
						set({isIdle: false}, false, {type: STORE_ACTION.TAIL.DISPATCH, event: "active"})
						dispatch({type: "ws_message", lastSeq: msg.seq})
						break
					case "warning":
						dispatch({type: "ws_message", lastSeq: msg.seq})
						break
					case "error":
						break
				}
			}

			return {
				connection: {status: "disconnected"} as TailConnection,
				sessionData: null,
				isIdle: false,
				autoScroll: true,
				newEventCount: 0,

				startTailing: (path: string) => {
					if (get().connection.status !== "disconnected") return
					// Reset autoScroll so each new tailing session starts scrolled to bottom
					set({autoScroll: true, newEventCount: 0}, false, {type: STORE_ACTION.TAIL.START_TAILING})
					const ws = new WebSocket(getWsUrl("/ws/session/tail"))
					ws.onopen = () => dispatch({type: "ws_open"})
					ws.onclose = () => dispatch({type: "ws_close"})
					ws.onerror = () => dispatch({type: "ws_error"})
					ws.onmessage = (e) => handleMessage(JSON.parse(e.data))
					dispatch({type: "start", path, ws})
				},
				stopTailing: () => {
					dispatch({type: "stop"})
					set({sessionData: null, isIdle: false, newEventCount: 0}, false, {
						type: STORE_ACTION.TAIL.STOP_TAILING,
					})
				},
				setAutoScroll: (v: boolean) => {
					// Skip write when value unchanged to avoid spurious rerenders during scroll
					if (get().autoScroll === v) return
					set({autoScroll: v}, false, {type: STORE_ACTION.TAIL.SET_AUTO_SCROLL, value: v})
				},
				resetNewEventCount: () =>
					set({newEventCount: 0}, false, {type: STORE_ACTION.TAIL.RESET_NEW_EVENT_COUNT}),
			}
		}),
		{name: STORE_DEVTOOLS_NAME[STORE_KEY.TAIL]},
	),
)
