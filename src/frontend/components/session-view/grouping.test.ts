import {describe, expect, it} from "bun:test"
import type {Event} from "#types"
import {groupTurnEvents} from "./grouping"

function makeAssistantMessageEvent(id: string): Event {
	return {
		id,
		parentId: null,
		timestamp: new Date("2026-01-01T00:00:00.000Z"),
		sessionId: "session-1",
		agentId: "agent-1",
		agentName: "Agent",
		type: "assistant-message",
		data: {
			type: "assistant-message",
			text: "assistant message",
		},
	}
}

function makeToolUseEvent({
	id,
	toolId,
	toolName,
}: {
	id: string
	toolId: string
	toolName?: string
}): Event {
	return {
		id,
		parentId: null,
		timestamp: new Date("2026-01-01T00:00:00.000Z"),
		sessionId: "session-1",
		agentId: "agent-1",
		agentName: "Agent",
		type: "tool-use",
		data: {
			type: "tool-use",
			toolName: toolName ?? "Bash",
			toolId,
			input: {},
		},
	}
}

function makeToolResultEvent({
	id,
	toolUseId,
}: {
	id: string
	toolUseId: string
}): Event {
	return {
		id,
		parentId: null,
		timestamp: new Date("2026-01-01T00:00:00.000Z"),
		sessionId: "session-1",
		agentId: "agent-1",
		agentName: "Agent",
		type: "tool-result",
		data: {
			type: "tool-result",
			toolUseId,
			success: true,
			output: "ok",
		},
	}
}

describe("groupTurnEvents", () => {
	it.each([
		{
			name: "keeps tool-use runs grouped as a tool-group",
			turnEvents: [
				makeToolUseEvent({id: "tool-use-1", toolId: "tool-1"}),
				makeToolResultEvent({id: "tool-result-1", toolUseId: "tool-1"}),
				makeAssistantMessageEvent("assistant-1"),
			],
			pairedResultIds: new Set(["tool-result-1"]),
			expectedKinds: ["tool-group", "single"] satisfies Array<"tool-group" | "single">,
		},
		{
			name: "does not create empty accordions from tool-result-only runs",
			turnEvents: [
				makeToolResultEvent({id: "tool-result-1", toolUseId: "tool-1"}),
				makeToolResultEvent({id: "tool-result-2", toolUseId: "tool-2"}),
			],
			pairedResultIds: new Set<string>(),
			expectedKinds: [] satisfies Array<"tool-group" | "single">,
		},
		{
			name: "drops trailing tool-result-only runs and keeps non-tool events",
			turnEvents: [
				makeToolResultEvent({id: "tool-result-1", toolUseId: "tool-1"}),
				makeAssistantMessageEvent("assistant-1"),
			],
			pairedResultIds: new Set<string>(),
			expectedKinds: ["single"] satisfies Array<"tool-group" | "single">,
		},
	])("$name", ({turnEvents, pairedResultIds, expectedKinds}) => {
		const items = groupTurnEvents(turnEvents, pairedResultIds)
		expect(items.map((item) => item.kind)).toEqual(expectedKinds)
	})
})
