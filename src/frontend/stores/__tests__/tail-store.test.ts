import {describe, expect, it} from "bun:test"
import {
	tailConnectionTransition,
	type TailConnection,
	type TailConnectionEffect,
	type TailConnectionEvent,
} from "../tail-store"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TransitionCase {
	state: TailConnection
	event: TailConnectionEvent
	expectedStatus: TailConnection["status"]
	expectedEffects: TailConnectionEffect["type"][]
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

const mockWs = {} as WebSocket

const disconnected = (): TailConnection => ({status: "disconnected"})
const connecting = (attempt = 0, lastSeq = 0, path = "/test.jsonl"): TailConnection => ({
	status: "connecting",
	path,
	ws: mockWs,
	lastSeq,
	attempt,
})
const connected = (lastSeq = 5, path = "/test.jsonl"): TailConnection => ({
	status: "connected",
	path,
	ws: mockWs,
	lastSeq,
})
const reconnecting = (attempt = 1, lastSeq = 5, path = "/test.jsonl"): TailConnection => ({
	status: "reconnecting",
	path,
	lastSeq,
	attempt,
})

// Event factories
const start = (path = "/test.jsonl"): TailConnectionEvent => ({type: "start", path, ws: mockWs})
const wsOpen: TailConnectionEvent = {type: "ws_open"}
const wsMessage = (lastSeq = 10): TailConnectionEvent => ({type: "ws_message", lastSeq})
const wsClose: TailConnectionEvent = {type: "ws_close"}
const wsError: TailConnectionEvent = {type: "ws_error"}
const reconnectTick: TailConnectionEvent = {type: "reconnect_tick", ws: mockWs}
const maxRetries: TailConnectionEvent = {type: "max_retries"}
const stop: TailConnectionEvent = {type: "stop"}

// ---------------------------------------------------------------------------
// Transition table
// ---------------------------------------------------------------------------

describe("tailConnectionTransition", () => {
	const cases: [string, TransitionCase][] = [
		// disconnected
		[
			"disconnected + start -> connecting (no effects, subscribe deferred to ws_open)",
			{
				state: disconnected(),
				event: start(),
				expectedStatus: "connecting",
				expectedEffects: [],
			},
		],
		[
			"disconnected + ws_open -> disconnected (ignored)",
			{state: disconnected(), event: wsOpen, expectedStatus: "disconnected", expectedEffects: []},
		],
		[
			"disconnected + ws_message -> disconnected (ignored)",
			{state: disconnected(), event: wsMessage(), expectedStatus: "disconnected", expectedEffects: []},
		],
		[
			"disconnected + ws_close -> disconnected (ignored)",
			{state: disconnected(), event: wsClose, expectedStatus: "disconnected", expectedEffects: []},
		],
		[
			"disconnected + ws_error -> disconnected (ignored)",
			{state: disconnected(), event: wsError, expectedStatus: "disconnected", expectedEffects: []},
		],
		[
			"disconnected + reconnect_tick -> disconnected (ignored)",
			{state: disconnected(), event: reconnectTick, expectedStatus: "disconnected", expectedEffects: []},
		],
		[
			"disconnected + max_retries -> disconnected (ignored)",
			{state: disconnected(), event: maxRetries, expectedStatus: "disconnected", expectedEffects: []},
		],
		[
			"disconnected + stop -> disconnected (ignored)",
			{state: disconnected(), event: stop, expectedStatus: "disconnected", expectedEffects: []},
		],

		// connecting
		[
			"connecting + ws_open -> connected (emits send_subscribe)",
			{state: connecting(), event: wsOpen, expectedStatus: "connected", expectedEffects: ["send_subscribe"]},
		],
		[
			"connecting + ws_error -> reconnecting",
			{
				state: connecting(),
				event: wsError,
				expectedStatus: "reconnecting",
				expectedEffects: ["schedule_reconnect"],
			},
		],
		[
			"connecting + ws_close -> reconnecting",
			{
				state: connecting(),
				event: wsClose,
				expectedStatus: "reconnecting",
				expectedEffects: ["schedule_reconnect"],
			},
		],
		[
			"connecting + stop -> disconnected",
			{state: connecting(), event: stop, expectedStatus: "disconnected", expectedEffects: ["close_ws"]},
		],
		[
			"connecting + start -> connecting (ignored)",
			{state: connecting(), event: start(), expectedStatus: "connecting", expectedEffects: []},
		],
		[
			"connecting + ws_message -> connecting (ignored)",
			{state: connecting(), event: wsMessage(), expectedStatus: "connecting", expectedEffects: []},
		],
		[
			"connecting + reconnect_tick -> connecting (ignored)",
			{state: connecting(), event: reconnectTick, expectedStatus: "connecting", expectedEffects: []},
		],
		[
			"connecting + max_retries -> connecting (ignored)",
			{state: connecting(), event: maxRetries, expectedStatus: "connecting", expectedEffects: []},
		],

		// connected
		[
			"connected + ws_message -> connected (update lastSeq)",
			{state: connected(5), event: wsMessage(10), expectedStatus: "connected", expectedEffects: []},
		],
		[
			"connected + ws_close -> reconnecting",
			{
				state: connected(5),
				event: wsClose,
				expectedStatus: "reconnecting",
				expectedEffects: ["schedule_reconnect"],
			},
		],
		[
			"connected + ws_error -> reconnecting",
			{
				state: connected(5),
				event: wsError,
				expectedStatus: "reconnecting",
				expectedEffects: ["schedule_reconnect"],
			},
		],
		[
			"connected + stop -> disconnected",
			{state: connected(5), event: stop, expectedStatus: "disconnected", expectedEffects: ["close_ws"]},
		],
		[
			"connected + start -> connected (ignored)",
			{state: connected(5), event: start(), expectedStatus: "connected", expectedEffects: []},
		],
		[
			"connected + ws_open -> connected (ignored)",
			{state: connected(5), event: wsOpen, expectedStatus: "connected", expectedEffects: []},
		],
		[
			"connected + reconnect_tick -> connected (ignored)",
			{state: connected(5), event: reconnectTick, expectedStatus: "connected", expectedEffects: []},
		],
		[
			"connected + max_retries -> connected (ignored)",
			{state: connected(5), event: maxRetries, expectedStatus: "connected", expectedEffects: []},
		],

		// reconnecting
		[
			"reconnecting + reconnect_tick -> connecting (no effects, subscribe deferred to ws_open)",
			{
				state: reconnecting(),
				event: reconnectTick,
				expectedStatus: "connecting",
				expectedEffects: [],
			},
		],
		[
			"reconnecting + max_retries -> disconnected",
			{state: reconnecting(), event: maxRetries, expectedStatus: "disconnected", expectedEffects: []},
		],
		[
			"reconnecting + stop -> disconnected",
			{
				state: reconnecting(),
				event: stop,
				expectedStatus: "disconnected",
				expectedEffects: ["cancel_reconnect"],
			},
		],
		[
			"reconnecting + start -> reconnecting (ignored)",
			{state: reconnecting(), event: start(), expectedStatus: "reconnecting", expectedEffects: []},
		],
		[
			"reconnecting + ws_open -> reconnecting (ignored)",
			{state: reconnecting(), event: wsOpen, expectedStatus: "reconnecting", expectedEffects: []},
		],
		[
			"reconnecting + ws_message -> reconnecting (ignored)",
			{state: reconnecting(), event: wsMessage(), expectedStatus: "reconnecting", expectedEffects: []},
		],
		[
			"reconnecting + ws_close -> reconnecting (ignored)",
			{state: reconnecting(), event: wsClose, expectedStatus: "reconnecting", expectedEffects: []},
		],
		[
			"reconnecting + ws_error -> reconnecting (ignored)",
			{state: reconnecting(), event: wsError, expectedStatus: "reconnecting", expectedEffects: []},
		],
	]

	describe("status transitions", () => {
		it.each(cases)("%s", (_name: string, tc: TransitionCase) => {
			const result = tailConnectionTransition(tc.state, tc.event)
			expect(result.state.status).toBe(tc.expectedStatus)
		})
	})

	describe("effects", () => {
		it.each(cases)("%s", (_name: string, tc: TransitionCase) => {
			const result = tailConnectionTransition(tc.state, tc.event)
			expect(result.effects.map((e) => e.type)).toEqual(tc.expectedEffects)
		})
	})

	describe("state data preservation", () => {
		it("disconnected + start carries path and ws into connecting state", () => {
			const ws = {} as WebSocket
			const result = tailConnectionTransition(disconnected(), {type: "start", path: "/custom.jsonl", ws})
			expect(result.state).toEqual({status: "connecting", path: "/custom.jsonl", ws, lastSeq: 0, attempt: 0})
		})

		it("disconnected + start emits no effects (subscribe deferred to ws_open)", () => {
			const ws = {} as WebSocket
			const result = tailConnectionTransition(disconnected(), {type: "start", path: "/custom.jsonl", ws})
			expect(result.effects).toEqual([])
		})

		it("connecting + ws_open emits send_subscribe with path and ws", () => {
			const result = tailConnectionTransition(connecting(), wsOpen)
			expect(result.effects).toEqual([{type: "send_subscribe", ws: mockWs, path: "/test.jsonl"}])
		})

		it("connecting + ws_open carries lastSeq forward to connected state", () => {
			const result = tailConnectionTransition(connecting(0, 0), wsOpen)
			expect(result.state).toEqual({status: "connected", path: "/test.jsonl", ws: mockWs, lastSeq: 0})
		})

		it("connecting + ws_open includes resumeAfterSeq when lastSeq > 0", () => {
			const result = tailConnectionTransition(connecting(2, 15), wsOpen)
			expect(result.effects).toEqual([
				{type: "send_subscribe", ws: mockWs, path: "/test.jsonl", resumeAfterSeq: 15},
			])
		})

		it("connected + ws_message updates lastSeq", () => {
			const result = tailConnectionTransition(connected(5), wsMessage(42))
			expect(result.state).toEqual({status: "connected", path: "/test.jsonl", ws: mockWs, lastSeq: 42})
		})

		it("connected + ws_close preserves lastSeq in reconnecting state", () => {
			const result = tailConnectionTransition(connected(7), wsClose)
			expect(result.state).toEqual({status: "reconnecting", path: "/test.jsonl", lastSeq: 7, attempt: 1})
		})

		it("connected + ws_close emits schedule_reconnect with correct lastSeq", () => {
			const result = tailConnectionTransition(connected(7), wsClose)
			expect(result.effects).toEqual([
				{type: "schedule_reconnect", attempt: 1, path: "/test.jsonl", lastSeq: 7},
			])
		})

		it("reconnecting + reconnect_tick carries attempt count into connecting state", () => {
			const ws = {} as WebSocket
			const result = tailConnectionTransition(reconnecting(3, 15), {type: "reconnect_tick", ws})
			expect(result.state).toEqual({status: "connecting", path: "/test.jsonl", ws, lastSeq: 15, attempt: 3})
		})

		it("connecting + ws_error increments attempt in reconnecting state", () => {
			const result = tailConnectionTransition(connecting(0), wsError)
			expect(result.state).toEqual({status: "reconnecting", path: "/test.jsonl", lastSeq: 0, attempt: 1})
		})

		it("attempt counter grows through reconnect cycles", () => {
			// reconnecting(3) -> reconnect_tick -> connecting(attempt=3)
			const ws = {} as WebSocket
			const afterTick = tailConnectionTransition(reconnecting(3, 5), {type: "reconnect_tick", ws})
			expect(afterTick.state.status).toBe("connecting")

			// connecting(attempt=3) -> ws_error -> reconnecting(attempt=4)
			const afterError = tailConnectionTransition(afterTick.state, wsError)
			expect(afterError.state).toEqual({status: "reconnecting", path: "/test.jsonl", lastSeq: 5, attempt: 4})

			// Verify the schedule_reconnect effect also has the correct attempt
			expect(afterError.effects).toEqual([
				{type: "schedule_reconnect", attempt: 4, path: "/test.jsonl", lastSeq: 5},
			])
		})
	})
})
