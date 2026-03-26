export const CLAUDE_LOG_ENTRY_TYPE = {
	USER: "user",
	ASSISTANT: "assistant",
	SUMMARY: "summary",
} as const

export const CLAUDE_CONTENT_TYPE = {
	TEXT: "text",
	THINKING: "thinking",
	TOOL_USE: "tool_use",
	TOOL_RESULT: "tool_result",
	TOOL_REFERENCE: "tool_reference",
} as const

export const SESSION_EVENT_TYPE = {
	USER_MESSAGE: "user-message",
	ASSISTANT_MESSAGE: "assistant-message",
	TOOL_USE: "tool-use",
	TOOL_RESULT: "tool-result",
	THINKING: "thinking",
	AGENT_SPAWN: "agent-spawn",
	SUMMARY: "summary",
} as const

export const SESSION_EVENT_TYPE_VALUES = [
	SESSION_EVENT_TYPE.USER_MESSAGE,
	SESSION_EVENT_TYPE.ASSISTANT_MESSAGE,
	SESSION_EVENT_TYPE.TOOL_USE,
	SESSION_EVENT_TYPE.TOOL_RESULT,
	SESSION_EVENT_TYPE.THINKING,
	SESSION_EVENT_TYPE.AGENT_SPAWN,
	SESSION_EVENT_TYPE.SUMMARY,
] as const
