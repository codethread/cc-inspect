import {describe, expect, it} from "bun:test"
import {
	sessionTransition,
	type SessionTailerEffect,
	type SessionTailerEvent,
	type SessionTailerState,
} from "../session-tailer"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TransitionCase {
	state: SessionTailerState
	event: SessionTailerEvent
	expectedStatus: SessionTailerState["status"]
	expectedEffects: SessionTailerEffect["type"][]
}

// State factories
const initializing = (): SessionTailerState => ({status: "initializing"})
const streaming = (): SessionTailerState => ({status: "streaming", lastWriteTime: Date.now()})
const idle = (): SessionTailerState => ({status: "idle", idleSince: Date.now()})
const error = (msg = "test error"): SessionTailerState => ({status: "error", error: msg})
const stopped = (): SessionTailerState => ({status: "stopped"})

// Event factories
const snapshotReady: SessionTailerEvent = {type: "snapshot_ready"}
const linesReceived: SessionTailerEvent = {type: "lines_received"}
const idleTimeout: SessionTailerEvent = {type: "idle_timeout"}
const noSubscribers: SessionTailerEvent = {type: "no_subscribers"}
const errorEvent: SessionTailerEvent = {type: "error", error: "bad"}
const stopEvent: SessionTailerEvent = {type: "stop"}

// ---------------------------------------------------------------------------
// Pure transition tests
// ---------------------------------------------------------------------------

describe("SessionTailer transition", () => {
	const cases: [string, TransitionCase][] = [
		// initializing
		[
			"initializing + snapshot_ready -> streaming",
			{
				state: initializing(),
				event: snapshotReady,
				expectedStatus: "streaming",
				expectedEffects: ["start_tailing", "broadcast_snapshot"],
			},
		],
		[
			"initializing + error -> error",
			{
				state: initializing(),
				event: errorEvent,
				expectedStatus: "error",
				expectedEffects: ["stop_all"],
			},
		],
		[
			"initializing + lines_received -> initializing (ignored)",
			{
				state: initializing(),
				event: linesReceived,
				expectedStatus: "initializing",
				expectedEffects: [],
			},
		],
		[
			"initializing + idle_timeout -> initializing (ignored)",
			{
				state: initializing(),
				event: idleTimeout,
				expectedStatus: "initializing",
				expectedEffects: [],
			},
		],
		[
			"initializing + no_subscribers -> initializing (ignored)",
			{
				state: initializing(),
				event: noSubscribers,
				expectedStatus: "initializing",
				expectedEffects: [],
			},
		],
		[
			"initializing + stop -> initializing (ignored)",
			{
				state: initializing(),
				event: stopEvent,
				expectedStatus: "initializing",
				expectedEffects: [],
			},
		],

		// streaming
		[
			"streaming + idle_timeout -> idle",
			{
				state: streaming(),
				event: idleTimeout,
				expectedStatus: "idle",
				expectedEffects: [],
			},
		],
		[
			"streaming + error -> error",
			{
				state: streaming(),
				event: errorEvent,
				expectedStatus: "error",
				expectedEffects: ["stop_all"],
			},
		],
		[
			"streaming + no_subscribers -> stopped",
			{
				state: streaming(),
				event: noSubscribers,
				expectedStatus: "stopped",
				expectedEffects: ["stop_all"],
			},
		],
		[
			"streaming + snapshot_ready -> streaming (ignored)",
			{
				state: streaming(),
				event: snapshotReady,
				expectedStatus: "streaming",
				expectedEffects: [],
			},
		],
		[
			"streaming + lines_received -> streaming (ignored)",
			{
				state: streaming(),
				event: linesReceived,
				expectedStatus: "streaming",
				expectedEffects: [],
			},
		],
		[
			"streaming + stop -> streaming (ignored)",
			{
				state: streaming(),
				event: stopEvent,
				expectedStatus: "streaming",
				expectedEffects: [],
			},
		],

		// idle
		[
			"idle + lines_received -> streaming",
			{
				state: idle(),
				event: linesReceived,
				expectedStatus: "streaming",
				expectedEffects: ["cancel_idle_check"],
			},
		],
		[
			"idle + no_subscribers -> stopped",
			{
				state: idle(),
				event: noSubscribers,
				expectedStatus: "stopped",
				expectedEffects: ["stop_all"],
			},
		],
		[
			"idle + snapshot_ready -> idle (ignored)",
			{
				state: idle(),
				event: snapshotReady,
				expectedStatus: "idle",
				expectedEffects: [],
			},
		],
		[
			"idle + idle_timeout -> idle (ignored)",
			{
				state: idle(),
				event: idleTimeout,
				expectedStatus: "idle",
				expectedEffects: [],
			},
		],
		[
			"idle + error -> idle (ignored)",
			{
				state: idle(),
				event: errorEvent,
				expectedStatus: "idle",
				expectedEffects: [],
			},
		],
		[
			"idle + stop -> idle (ignored)",
			{
				state: idle(),
				event: stopEvent,
				expectedStatus: "idle",
				expectedEffects: [],
			},
		],

		// error
		[
			"error + stop -> stopped",
			{
				state: error(),
				event: stopEvent,
				expectedStatus: "stopped",
				expectedEffects: ["stop_all"],
			},
		],
		[
			"error + snapshot_ready -> error (ignored)",
			{
				state: error(),
				event: snapshotReady,
				expectedStatus: "error",
				expectedEffects: [],
			},
		],
		[
			"error + lines_received -> error (ignored)",
			{
				state: error(),
				event: linesReceived,
				expectedStatus: "error",
				expectedEffects: [],
			},
		],
		[
			"error + idle_timeout -> error (ignored)",
			{
				state: error(),
				event: idleTimeout,
				expectedStatus: "error",
				expectedEffects: [],
			},
		],
		[
			"error + no_subscribers -> error (ignored)",
			{
				state: error(),
				event: noSubscribers,
				expectedStatus: "error",
				expectedEffects: [],
			},
		],
		[
			"error + error -> error (ignored)",
			{
				state: error(),
				event: errorEvent,
				expectedStatus: "error",
				expectedEffects: [],
			},
		],

		// stopped
		[
			"stopped + snapshot_ready -> stopped (ignored)",
			{
				state: stopped(),
				event: snapshotReady,
				expectedStatus: "stopped",
				expectedEffects: [],
			},
		],
		[
			"stopped + lines_received -> stopped (ignored)",
			{
				state: stopped(),
				event: linesReceived,
				expectedStatus: "stopped",
				expectedEffects: [],
			},
		],
		[
			"stopped + idle_timeout -> stopped (ignored)",
			{
				state: stopped(),
				event: idleTimeout,
				expectedStatus: "stopped",
				expectedEffects: [],
			},
		],
		[
			"stopped + no_subscribers -> stopped (ignored)",
			{
				state: stopped(),
				event: noSubscribers,
				expectedStatus: "stopped",
				expectedEffects: [],
			},
		],
		[
			"stopped + error -> stopped (ignored)",
			{
				state: stopped(),
				event: errorEvent,
				expectedStatus: "stopped",
				expectedEffects: [],
			},
		],
		[
			"stopped + stop -> stopped (ignored)",
			{
				state: stopped(),
				event: stopEvent,
				expectedStatus: "stopped",
				expectedEffects: [],
			},
		],
	]

	describe("status transitions", () => {
		it.each(cases)("%s", (_name: string, tc: TransitionCase) => {
			const result = sessionTransition(tc.state, tc.event)
			expect(result.state.status).toBe(tc.expectedStatus)
		})
	})

	describe("effects", () => {
		it.each(cases)("%s", (_name: string, tc: TransitionCase) => {
			const result = sessionTransition(tc.state, tc.event)
			expect(result.effects.map((e) => e.type)).toEqual(tc.expectedEffects)
		})
	})

	describe("state data", () => {
		it("streaming state has lastWriteTime", () => {
			const before = Date.now()
			const result = sessionTransition(initializing(), snapshotReady)
			const after = Date.now()

			expect(result.state.status).toBe("streaming")
			if (result.state.status === "streaming") {
				expect(result.state.lastWriteTime).toBeGreaterThanOrEqual(before)
				expect(result.state.lastWriteTime).toBeLessThanOrEqual(after)
			}
		})

		it("idle state has idleSince", () => {
			const before = Date.now()
			const result = sessionTransition(streaming(), idleTimeout)
			const after = Date.now()

			expect(result.state.status).toBe("idle")
			if (result.state.status === "idle") {
				expect(result.state.idleSince).toBeGreaterThanOrEqual(before)
				expect(result.state.idleSince).toBeLessThanOrEqual(after)
			}
		})

		it("error state preserves error message", () => {
			const result = sessionTransition(initializing(), {type: "error", error: "custom error msg"})
			expect(result.state.status).toBe("error")
			if (result.state.status === "error") {
				expect(result.state.error).toBe("custom error msg")
			}
		})

		it("idle + lines_received produces streaming with fresh lastWriteTime", () => {
			const before = Date.now()
			const result = sessionTransition(idle(), linesReceived)
			const after = Date.now()

			expect(result.state.status).toBe("streaming")
			if (result.state.status === "streaming") {
				expect(result.state.lastWriteTime).toBeGreaterThanOrEqual(before)
				expect(result.state.lastWriteTime).toBeLessThanOrEqual(after)
			}
		})
	})
})
