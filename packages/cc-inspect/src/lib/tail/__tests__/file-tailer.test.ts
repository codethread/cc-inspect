import {appendFileSync, mkdirSync, unlinkSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {afterEach, beforeAll, beforeEach, describe, expect, it} from "bun:test"
import {initLogging} from "../../log/server-instance"
import {
	FileTailer,
	transition,
	type FileTailerEffect,
	type FileTailerEvent,
	type FileTailerState,
} from "../file-tailer"

// ---------------------------------------------------------------------------
// Test setup — logging must be initialized before FileTailer can log
// ---------------------------------------------------------------------------

beforeAll(() => {
	const logDir = join(tmpdir(), `file-tailer-test-logs-${crypto.randomUUID()}`)
	mkdirSync(logDir, {recursive: true})
	initLogging(logDir, "debug")
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TransitionCase {
	state: FileTailerState
	event: FileTailerEvent
	expectedStatus: FileTailerState["status"]
	expectedEffects: FileTailerEffect["type"][]
}

// State factories
const waiting = (path = "/test.jsonl"): FileTailerState => ({status: "waiting", path})
const watching = (path = "/test.jsonl"): FileTailerState => ({status: "watching", path})
const pollingFallback = (path = "/test.jsonl"): FileTailerState => ({status: "polling_fallback", path})
const deleted = (path = "/test.jsonl"): FileTailerState => ({status: "deleted", path})
const stopped = (): FileTailerState => ({status: "stopped"})

// Event factories
const fileAppeared: FileTailerEvent = {type: "file_appeared"}
const watchError: FileTailerEvent = {type: "watch_error", error: new Error("test")}
const fileDeleted: FileTailerEvent = {type: "file_deleted"}
const watchRestored: FileTailerEvent = {type: "watch_restored"}
const stop: FileTailerEvent = {type: "stop"}

// ---------------------------------------------------------------------------
// Pure transition tests
// ---------------------------------------------------------------------------

describe("FileTailer transition", () => {
	const cases: [string, TransitionCase][] = [
		// waiting
		[
			"waiting + file_appeared -> watching",
			{
				state: waiting(),
				event: fileAppeared,
				expectedStatus: "watching",
				expectedEffects: ["start_watcher", "read_new_bytes"],
			},
		],
		[
			"waiting + stop -> stopped",
			{state: waiting(), event: stop, expectedStatus: "stopped", expectedEffects: ["clear_timers"]},
		],
		[
			"waiting + watch_error -> waiting (ignored)",
			{state: waiting(), event: watchError, expectedStatus: "waiting", expectedEffects: []},
		],
		[
			"waiting + file_deleted -> waiting (ignored)",
			{state: waiting(), event: fileDeleted, expectedStatus: "waiting", expectedEffects: []},
		],
		[
			"waiting + watch_restored -> waiting (ignored)",
			{state: waiting(), event: watchRestored, expectedStatus: "waiting", expectedEffects: []},
		],
		// watching
		[
			"watching + watch_error -> polling_fallback",
			{
				state: watching(),
				event: watchError,
				expectedStatus: "polling_fallback",
				expectedEffects: ["stop_watcher", "start_poll_interval"],
			},
		],
		[
			"watching + file_deleted -> deleted",
			{
				state: watching(),
				event: fileDeleted,
				expectedStatus: "deleted",
				expectedEffects: ["stop_watcher", "emit_deleted"],
			},
		],
		[
			"watching + stop -> stopped",
			{
				state: watching(),
				event: stop,
				expectedStatus: "stopped",
				expectedEffects: ["stop_watcher", "clear_timers"],
			},
		],
		[
			"watching + file_appeared -> watching (ignored)",
			{state: watching(), event: fileAppeared, expectedStatus: "watching", expectedEffects: []},
		],
		[
			"watching + watch_restored -> watching (ignored)",
			{state: watching(), event: watchRestored, expectedStatus: "watching", expectedEffects: []},
		],
		// polling_fallback
		[
			"polling_fallback + watch_restored -> watching",
			{
				state: pollingFallback(),
				event: watchRestored,
				expectedStatus: "watching",
				expectedEffects: ["stop_poll_interval", "start_watcher"],
			},
		],
		[
			"polling_fallback + file_deleted -> deleted",
			{
				state: pollingFallback(),
				event: fileDeleted,
				expectedStatus: "deleted",
				expectedEffects: ["stop_poll_interval", "emit_deleted"],
			},
		],
		[
			"polling_fallback + stop -> stopped",
			{
				state: pollingFallback(),
				event: stop,
				expectedStatus: "stopped",
				expectedEffects: ["stop_poll_interval", "clear_timers"],
			},
		],
		[
			"polling_fallback + file_appeared -> polling_fallback (ignored)",
			{
				state: pollingFallback(),
				event: fileAppeared,
				expectedStatus: "polling_fallback",
				expectedEffects: [],
			},
		],
		[
			"polling_fallback + watch_error -> polling_fallback (ignored)",
			{state: pollingFallback(), event: watchError, expectedStatus: "polling_fallback", expectedEffects: []},
		],
		// deleted
		[
			"deleted + stop -> stopped",
			{state: deleted(), event: stop, expectedStatus: "stopped", expectedEffects: []},
		],
		[
			"deleted + file_appeared -> deleted (ignored)",
			{state: deleted(), event: fileAppeared, expectedStatus: "deleted", expectedEffects: []},
		],
		[
			"deleted + watch_error -> deleted (ignored)",
			{state: deleted(), event: watchError, expectedStatus: "deleted", expectedEffects: []},
		],
		[
			"deleted + file_deleted -> deleted (ignored)",
			{state: deleted(), event: fileDeleted, expectedStatus: "deleted", expectedEffects: []},
		],
		[
			"deleted + watch_restored -> deleted (ignored)",
			{state: deleted(), event: watchRestored, expectedStatus: "deleted", expectedEffects: []},
		],
		// stopped
		[
			"stopped + file_appeared -> stopped (ignored)",
			{state: stopped(), event: fileAppeared, expectedStatus: "stopped", expectedEffects: []},
		],
		[
			"stopped + stop -> stopped (ignored)",
			{state: stopped(), event: stop, expectedStatus: "stopped", expectedEffects: []},
		],
		[
			"stopped + watch_error -> stopped (ignored)",
			{state: stopped(), event: watchError, expectedStatus: "stopped", expectedEffects: []},
		],
		[
			"stopped + file_deleted -> stopped (ignored)",
			{state: stopped(), event: fileDeleted, expectedStatus: "stopped", expectedEffects: []},
		],
		[
			"stopped + watch_restored -> stopped (ignored)",
			{state: stopped(), event: watchRestored, expectedStatus: "stopped", expectedEffects: []},
		],
	]

	describe("status transitions", () => {
		it.each(cases)("%s", (_name: string, tc: TransitionCase) => {
			const result = transition(tc.state, tc.event)
			expect(result.state.status).toBe(tc.expectedStatus)
		})
	})

	describe("effects", () => {
		it.each(cases)("%s", (_name: string, tc: TransitionCase) => {
			const result = transition(tc.state, tc.event)
			expect(result.effects.map((e) => e.type)).toEqual(tc.expectedEffects)
		})
	})

	describe("path preservation", () => {
		it("preserves path in state when transitioning from waiting to watching", () => {
			const result = transition(waiting("/custom/path.jsonl"), fileAppeared)
			expect(result.state).toEqual({status: "watching", path: "/custom/path.jsonl"})
		})

		it("preserves path in start_watcher effect", () => {
			const result = transition(waiting("/custom/path.jsonl"), fileAppeared)
			const startWatcher = result.effects.find((e) => e.type === "start_watcher")
			expect(startWatcher).toEqual({type: "start_watcher", path: "/custom/path.jsonl"})
		})

		it("preserves path in read_new_bytes effect", () => {
			const result = transition(waiting("/custom/path.jsonl"), fileAppeared)
			const readBytes = result.effects.find((e) => e.type === "read_new_bytes")
			expect(readBytes).toEqual({type: "read_new_bytes", path: "/custom/path.jsonl", offset: 0})
		})
	})
})

// ---------------------------------------------------------------------------
// Integration tests
// ---------------------------------------------------------------------------

describe("FileTailer integration", () => {
	let tempDir: string
	let tailer: FileTailer | null = null

	beforeEach(() => {
		tempDir = join(tmpdir(), `file-tailer-test-${crypto.randomUUID()}`)
		mkdirSync(tempDir, {recursive: true})
	})

	afterEach(() => {
		if (tailer) {
			tailer.stop()
			tailer = null
		}
	})

	it("emits lines appended to a file", async () => {
		const filePath = join(tempDir, "test.jsonl")
		writeFileSync(filePath, "")

		const received: string[] = []
		const errors: Error[] = []

		tailer = new FileTailer({
			path: filePath,
			onLines: (lines) => received.push(...lines),
			onError: (err) => errors.push(err),
			onDeleted: () => {},
		})

		// Wait for init + watcher/poll setup. The tailer may be in watching
		// or polling_fallback depending on OS fs.watch support for temp dirs.
		await Bun.sleep(300)

		appendFileSync(filePath, "line1\nline2\nline3\n")

		// Wait long enough for either the debounced watcher (50ms) or
		// the safety poll (2000ms) to read the new bytes.
		await Bun.sleep(2500)

		expect(received).toEqual(["line1", "line2", "line3"])
		expect(errors).toHaveLength(0)
	})

	it("handles partial lines (carry buffer)", async () => {
		const filePath = join(tempDir, "partial.jsonl")
		writeFileSync(filePath, "")

		const received: string[] = []

		tailer = new FileTailer({
			path: filePath,
			onLines: (lines) => received.push(...lines),
			onError: () => {},
			onDeleted: () => {},
		})

		await Bun.sleep(300)

		// Write a partial line (no trailing newline)
		appendFileSync(filePath, "partial")
		// Wait for watcher + safety poll to pick it up (up to 2s safety poll)
		await Bun.sleep(2500)

		// Should not have emitted the partial line (no newline yet)
		expect(received).toEqual([])

		// Complete the line and add another
		appendFileSync(filePath, " complete\nfull line\n")
		// Wait for safety poll to pick up the second write
		await Bun.sleep(2500)

		expect(received).toEqual(["partial complete", "full line"])
	}, 10000)

	it("waits for file to appear when it does not exist initially", async () => {
		const filePath = join(tempDir, "nonexistent.jsonl")

		const received: string[] = []

		tailer = new FileTailer({
			path: filePath,
			onLines: (lines) => received.push(...lines),
			onError: () => {},
			onDeleted: () => {},
		})

		// Should be in waiting state
		expect(tailer.getStatus()).toBe("waiting")

		await Bun.sleep(200)

		// Create the file with a line
		writeFileSync(filePath, "appeared line\n")

		// Wait for the 500ms poll to detect + watcher setup + read
		await Bun.sleep(1500)

		// Should have transitioned to watching or polling_fallback (both are active)
		const status = tailer.getStatus()
		expect(status === "watching" || status === "polling_fallback").toBe(true)
		expect(received).toEqual(["appeared line"])
	})

	it("strips \\r from lines", async () => {
		const filePath = join(tempDir, "crlf.jsonl")
		writeFileSync(filePath, "")

		const received: string[] = []

		tailer = new FileTailer({
			path: filePath,
			onLines: (lines) => received.push(...lines),
			onError: () => {},
			onDeleted: () => {},
		})

		await Bun.sleep(300)

		appendFileSync(filePath, "line with cr\r\nand another\r\n")
		await Bun.sleep(2500)

		expect(received).toEqual(["line with cr", "and another"])
	})

	it("detects file deletion and calls onDeleted", async () => {
		const filePath = join(tempDir, "deleteme.jsonl")
		writeFileSync(filePath, "initial\n")

		let deletedCalled = false

		tailer = new FileTailer({
			path: filePath,
			onLines: () => {},
			onError: () => {},
			onDeleted: () => {
				deletedCalled = true
			},
		})

		await Bun.sleep(300)

		// Should be actively tailing (watching or polling_fallback)
		const statusBefore = tailer.getStatus()
		expect(statusBefore === "watching" || statusBefore === "polling_fallback").toBe(true)

		// Delete the file
		unlinkSync(filePath)

		// Wait for watcher/poll to detect deletion
		await Bun.sleep(2500)

		expect(deletedCalled).toBe(true)
		expect(tailer.getStatus()).toBe("deleted")
	})

	it("stop() transitions to stopped and cleans up", async () => {
		const filePath = join(tempDir, "stoptest.jsonl")
		writeFileSync(filePath, "data\n")

		tailer = new FileTailer({
			path: filePath,
			onLines: () => {},
			onError: () => {},
			onDeleted: () => {},
		})

		await Bun.sleep(300)

		// Should be actively tailing
		const statusBefore = tailer.getStatus()
		expect(statusBefore === "watching" || statusBefore === "polling_fallback").toBe(true)

		tailer.stop()
		expect(tailer.getStatus()).toBe("stopped")
		tailer = null // already stopped
	})
})
