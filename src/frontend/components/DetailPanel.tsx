import type {AgentNode, Event} from "#types"
import {MarkdownContent} from "./MarkdownContent"
import {getAgentColorSet} from "./session-view/agent-colors"
import {formatTime} from "./session-view/helpers"

export function DetailPanel({
	event,
	allEvents,
	agents,
	onNavigate,
}: {
	event: Event | null
	allEvents: Event[]
	agents: AgentNode[]
	onNavigate?: () => void
}) {
	if (!event) {
		return (
			<div className="h-full flex items-center justify-center bg-zinc-950 border-l border-zinc-800">
				<div className="text-center px-6">
					<div className="text-zinc-600 text-sm mb-1">No event selected</div>
					<div className="text-zinc-700 text-xs">Click an event in the timeline to view its details</div>
				</div>
			</div>
		)
	}

	const colors = getAgentColorSet(agents, event.agentId)

	const toolId = event.data.type === "tool-use" ? event.data.toolId : null
	const linkedResult = toolId
		? allEvents.find((e) => e.data.type === "tool-result" && e.data.toolUseId === toolId)
		: null
	const toolUseId = event.data.type === "tool-result" ? event.data.toolUseId : null
	const linkedUse = toolUseId
		? allEvents.find((e) => e.data.type === "tool-use" && e.data.toolId === toolUseId)
		: null

	return (
		<div className="h-full flex flex-col bg-zinc-950 border-l border-zinc-800">
			{/* Header */}
			<div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800 flex-shrink-0">
				<span className="w-2 h-2 rounded-full flex-shrink-0" style={{backgroundColor: colors.dot}} />
				<span className="text-xs text-zinc-400">
					{event.agentName ?? event.agentId?.slice(0, 10) ?? "main"}
				</span>
				<span className="text-xs text-zinc-600 font-mono tabular-nums ml-auto">
					{formatTime(event.timestamp)}
				</span>
				{onNavigate && (
					<button
						type="button"
						onClick={onNavigate}
						className="flex items-center gap-1 px-2 py-0.5 rounded-md text-xs text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer ml-2"
						title="Open in timeline"
					>
						<svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
							/>
						</svg>
						timeline
					</button>
				)}
			</div>

			{/* Content */}
			<div className="flex-1 overflow-y-auto min-h-0">
				{event.data.type === "user-message" && (
					<div className="px-4 py-4">
						<div className="text-xs font-semibold text-sky-400 uppercase tracking-wider mb-3">
							User Message
						</div>
						<MarkdownContent className="text-zinc-200 text-sm leading-relaxed">
							{event.data.text}
						</MarkdownContent>
					</div>
				)}

				{event.data.type === "assistant-message" && (
					<div className="px-4 py-4">
						<div className="text-xs font-semibold text-violet-400 uppercase tracking-wider mb-3">
							Assistant
						</div>
						<MarkdownContent className="text-zinc-200 text-sm leading-relaxed">
							{event.data.text}
						</MarkdownContent>
					</div>
				)}

				{event.data.type === "thinking" && (
					<div className="px-4 py-4">
						<div className="text-xs font-semibold text-fuchsia-400 uppercase tracking-wider mb-3">
							Thinking
						</div>
						<div className="text-zinc-400 text-sm leading-relaxed whitespace-pre-wrap italic">
							{event.data.content}
						</div>
					</div>
				)}

				{event.data.type === "tool-use" && (
					<div className="px-4 py-4">
						<div className="flex items-center gap-2 mb-3">
							<span className="text-xs font-semibold text-amber-400 uppercase tracking-wider">Tool Call</span>
							<span className="text-amber-400 font-mono text-sm font-medium">{event.data.toolName}</span>
						</div>
						{event.data.description && (
							<div className="text-zinc-400 text-sm mb-3">{event.data.description}</div>
						)}
						<div className="text-xs font-medium text-zinc-500 mb-1.5 uppercase tracking-wider">Input</div>
						<pre className="text-sm text-zinc-300 font-mono whitespace-pre-wrap break-words leading-relaxed bg-zinc-900 rounded-lg p-3 border border-zinc-800 mb-4">
							{JSON.stringify(event.data.input, null, 2)}
						</pre>

						{linkedResult && linkedResult.data.type === "tool-result" && (
							<>
								<div className="text-xs font-medium uppercase tracking-wider mb-1.5">
									<span className={linkedResult.data.success ? "text-emerald-400" : "text-red-400"}>
										Result {linkedResult.data.success ? "(OK)" : "(Error)"}
									</span>
								</div>
								<pre className="text-sm text-zinc-400 font-mono whitespace-pre-wrap break-words leading-relaxed bg-zinc-900 rounded-lg p-3 border border-zinc-800 max-h-96 overflow-y-auto">
									{linkedResult.data.output}
								</pre>
							</>
						)}
					</div>
				)}

				{event.data.type === "tool-result" && (
					<div className="px-4 py-4">
						<div className="flex items-center gap-2 mb-3">
							<span className="text-xs font-semibold uppercase tracking-wider">
								<span className={event.data.success ? "text-emerald-400" : "text-red-400"}>
									Result {event.data.success ? "(OK)" : "(Error)"}
								</span>
							</span>
						</div>

						{linkedUse && linkedUse.data.type === "tool-use" && (
							<>
								<div className="text-xs font-medium text-zinc-500 mb-1.5 uppercase tracking-wider">
									Tool: {linkedUse.data.toolName}
								</div>
								<pre className="text-sm text-zinc-300 font-mono whitespace-pre-wrap break-words leading-relaxed bg-zinc-900 rounded-lg p-3 border border-zinc-800 mb-4 max-h-48 overflow-y-auto">
									{JSON.stringify(linkedUse.data.input, null, 2)}
								</pre>
							</>
						)}

						<div className="text-xs font-medium text-zinc-500 mb-1.5 uppercase tracking-wider">Output</div>
						<pre className="text-sm text-zinc-400 font-mono whitespace-pre-wrap break-words leading-relaxed bg-zinc-900 rounded-lg p-3 border border-zinc-800 max-h-[60vh] overflow-y-auto">
							{event.data.output}
						</pre>
					</div>
				)}

				{event.data.type === "agent-spawn" && (
					<div className="px-4 py-4">
						<div className="text-xs font-semibold text-orange-400 uppercase tracking-wider mb-3">
							Agent Spawned
						</div>
						<div className="text-zinc-300 text-sm mb-3">{event.data.description}</div>
						{event.data.model && <div className="text-xs text-zinc-600 mb-3">Model: {event.data.model}</div>}
						<div className="text-xs font-medium text-zinc-500 mb-1.5 uppercase tracking-wider">Prompt</div>
						<MarkdownContent className="text-zinc-300 text-sm leading-relaxed">
							{event.data.prompt}
						</MarkdownContent>
					</div>
				)}

				{event.data.type === "summary" && (
					<div className="px-4 py-4">
						<div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Summary</div>
						<MarkdownContent className="text-zinc-400 text-sm leading-relaxed">
							{event.data.summary}
						</MarkdownContent>
					</div>
				)}
			</div>
		</div>
	)
}
