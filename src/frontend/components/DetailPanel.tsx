import {useEffect, useMemo, useState} from "react"
import {AlertCircleIcon, CheckIcon, CircleQuestionMarkIcon, CopyIcon} from "lucide-react"
import type {AgentNode, Event} from "#types"
import {MarkdownContent} from "./MarkdownContent"
import {getAgentColorSet} from "./session-view/agent-colors"
import {formatTime} from "./session-view/helpers"
import {Popover, PopoverContent, PopoverTrigger} from "./ui/popover"

type CopyStatus = "idle" | "copied" | "error"

function getCopyIcon(status: CopyStatus, className: string) {
	if (status === "copied") return <CheckIcon className={className} aria-hidden="true" />
	if (status === "error") return <AlertCircleIcon className={className} aria-hidden="true" />
	return <CopyIcon className={className} aria-hidden="true" />
}

function shellQuote(value: string) {
	return `'${value.replaceAll("'", "'\\''")}'`
}

async function copyTextToClipboard(text: string): Promise<boolean> {
	try {
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(text)
			return true
		}
	} catch {
		// Fall through to the document.execCommand fallback.
	}

	try {
		const textarea = document.createElement("textarea")
		textarea.value = text
		textarea.setAttribute("readonly", "")
		textarea.style.position = "fixed"
		textarea.style.opacity = "0"
		document.body.append(textarea)
		textarea.select()
		const copied = document.execCommand("copy")
		textarea.remove()
		return copied
	} catch {
		return false
	}
}

export function DetailPanel({
	event,
	allEvents,
	agents,
	sessionFilePath,
	onNavigate,
}: {
	event: Event | null
	allEvents: Event[]
	agents: AgentNode[]
	sessionFilePath?: string | null
	onNavigate?: () => void
}) {
	const [copyState, setCopyState] = useState<{
		status: CopyStatus
		eventId: string | null
		key: string | null
	}>({
		status: "idle",
		eventId: null,
		key: null,
	})

	const toolId = event?.data.type === "tool-use" ? event.data.toolId : null
	const linkedResult = toolId
		? allEvents.find((e) => e.data.type === "tool-result" && e.data.toolUseId === toolId)
		: null
	const toolUseId = event?.data.type === "tool-result" ? event.data.toolUseId : null
	const linkedUse = toolUseId
		? allEvents.find((e) => e.data.type === "tool-use" && e.data.toolId === toolUseId)
		: null

	const toolUseInputText =
		event?.data.type === "tool-use" ? JSON.stringify(event.data.input, null, 2) : undefined
	const linkedToolUseInputText =
		linkedUse?.data.type === "tool-use" ? JSON.stringify(linkedUse.data.input, null, 2) : undefined

	const resolvedSessionFilePath = useMemo(() => {
		if (sessionFilePath?.trim()) return sessionFilePath.trim()
		if (!event) return "<session-file-path>"
		return `${event.sessionId}.jsonl`
	}, [sessionFilePath, event])

	const jqCommand = useMemo(() => {
		if (!event) return ""
		const filter = `select(.uuid == ${JSON.stringify(event.id)})`
		return `jq -c ${shellQuote(filter)} ${shellQuote(resolvedSessionFilePath)}`
	}, [event, resolvedSessionFilePath])

	const getCopyStatus = (key: string): CopyStatus =>
		copyState.eventId === event?.id && copyState.key === key ? copyState.status : "idle"

	const getCopyButtonClass = (status: CopyStatus) =>
		`inline-flex items-center justify-center w-5 h-5 rounded transition-colors cursor-pointer ${
			status === "copied"
				? "text-emerald-400"
				: status === "error"
					? "text-red-400"
					: "text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800"
		}`

	useEffect(() => {
		if (copyState.status === "idle") return
		const timeout = window.setTimeout(() => {
			setCopyState((state) => ({...state, status: "idle"}))
		}, 1800)
		return () => {
			window.clearTimeout(timeout)
		}
	}, [copyState.status])

	const handleCopy = async (copyKey: string, text: string) => {
		if (!event) return
		const copied = await copyTextToClipboard(text)
		setCopyState({
			status: copied ? "copied" : "error",
			eventId: event.id,
			key: copyKey,
		})
	}

	const renderCopyIconButton = (copyKey: string, text: string, title: string) => {
		const status = getCopyStatus(copyKey)
		return (
			<button
				type="button"
				onClick={() => void handleCopy(copyKey, text)}
				className={getCopyButtonClass(status)}
				title={title}
			>
				{getCopyIcon(status, "w-3 h-3")}
			</button>
		)
	}

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
	const copyIdStatus = getCopyStatus("event-id")
	const copyJqStatus = getCopyStatus("jq-command")

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
				<button
					type="button"
					onClick={() => void handleCopy("event-id", event.id)}
					className="flex items-center gap-1 px-2 py-0.5 rounded-md text-xs text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer"
					title="Copy event ID"
				>
					{getCopyIcon(copyIdStatus, "w-3 h-3")}
					{copyIdStatus === "copied" ? "id copied" : copyIdStatus === "error" ? "copy failed" : "copy id"}
				</button>
				<Popover>
					<PopoverTrigger asChild>
						<button
							type="button"
							className="inline-flex items-center justify-center w-5 h-5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer"
							title="How to find this event in raw logs"
						>
							<CircleQuestionMarkIcon className="w-3 h-3" aria-hidden="true" />
						</button>
					</PopoverTrigger>
					<PopoverContent align="end" className="w-[28rem] bg-zinc-900 border-zinc-700 text-zinc-200 p-3">
						<div className="text-xs text-zinc-300 leading-relaxed">
							Use the event ID with <span className="font-mono text-zinc-100">jq</span> to locate the exact
							raw entry in this session file.
						</div>
						<div className="mt-2 text-[11px] text-zinc-500 uppercase tracking-wider">Session File</div>
						<pre className="mt-1 text-xs text-zinc-400 font-mono whitespace-pre-wrap break-all bg-zinc-950 rounded border border-zinc-800 p-2">
							{resolvedSessionFilePath}
						</pre>
						<div className="mt-2 flex items-center justify-between">
							<span className="text-[11px] text-zinc-500 uppercase tracking-wider">Command</span>
							<button
								type="button"
								onClick={() => void handleCopy("jq-command", jqCommand)}
								className={getCopyButtonClass(copyJqStatus)}
								title="Copy jq command"
							>
								{getCopyIcon(copyJqStatus, "w-3 h-3")}
							</button>
						</div>
						<pre className="mt-1 text-xs text-zinc-300 font-mono whitespace-pre-wrap break-all bg-zinc-950 rounded border border-zinc-800 p-2">
							{jqCommand}
						</pre>
					</PopoverContent>
				</Popover>
				{onNavigate && (
					<button
						type="button"
						onClick={onNavigate}
						className="flex items-center gap-1 px-2 py-0.5 rounded-md text-xs text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer ml-1"
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
						<div className="flex items-center justify-between mb-3">
							<div className="text-xs font-semibold text-sky-400 uppercase tracking-wider">User Message</div>
							{renderCopyIconButton("user-message", event.data.text, "Copy user message")}
						</div>
						<MarkdownContent className="text-zinc-200 text-sm leading-relaxed">
							{event.data.text}
						</MarkdownContent>
					</div>
				)}

				{event.data.type === "assistant-message" && (
					<div className="px-4 py-4">
						<div className="flex items-center justify-between mb-3">
							<div className="text-xs font-semibold text-violet-400 uppercase tracking-wider">Assistant</div>
							{renderCopyIconButton("assistant-message", event.data.text, "Copy assistant message")}
						</div>
						<MarkdownContent className="text-zinc-200 text-sm leading-relaxed">
							{event.data.text}
						</MarkdownContent>
					</div>
				)}

				{event.data.type === "thinking" && (
					<div className="px-4 py-4">
						<div className="flex items-center justify-between mb-3">
							<div className="text-xs font-semibold text-fuchsia-400 uppercase tracking-wider">Thinking</div>
							{renderCopyIconButton("thinking", event.data.content, "Copy thinking content")}
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
						<div className="flex items-center justify-between mb-1.5">
							<div className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Input</div>
							{toolUseInputText
								? renderCopyIconButton("tool-use-input", toolUseInputText, "Copy tool input JSON")
								: null}
						</div>
						<pre className="text-sm text-zinc-300 font-mono whitespace-pre-wrap break-words leading-relaxed bg-zinc-900 rounded-lg p-3 border border-zinc-800 mb-4">
							{toolUseInputText}
						</pre>

						{linkedResult && linkedResult.data.type === "tool-result" && (
							<>
								<div className="flex items-center justify-between mb-1.5">
									<div className="text-xs font-medium uppercase tracking-wider">
										<span className={linkedResult.data.success ? "text-emerald-400" : "text-red-400"}>
											Result {linkedResult.data.success ? "(OK)" : "(Error)"}
										</span>
									</div>
									{renderCopyIconButton(
										"linked-tool-result-output",
										linkedResult.data.output,
										"Copy linked tool result output",
									)}
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
								<div className="flex items-center justify-between mb-1.5">
									<div className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
										Tool: {linkedUse.data.toolName}
									</div>
									{linkedToolUseInputText
										? renderCopyIconButton(
												"linked-tool-use-input",
												linkedToolUseInputText,
												"Copy linked tool input JSON",
											)
										: null}
								</div>
								<pre className="text-sm text-zinc-300 font-mono whitespace-pre-wrap break-words leading-relaxed bg-zinc-900 rounded-lg p-3 border border-zinc-800 mb-4 max-h-48 overflow-y-auto">
									{linkedToolUseInputText}
								</pre>
							</>
						)}

						<div className="flex items-center justify-between mb-1.5">
							<div className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Output</div>
							{renderCopyIconButton("tool-result-output", event.data.output, "Copy tool output")}
						</div>
						<pre className="text-sm text-zinc-400 font-mono whitespace-pre-wrap break-words leading-relaxed bg-zinc-900 rounded-lg p-3 border border-zinc-800 max-h-[60vh] overflow-y-auto">
							{event.data.output}
						</pre>
					</div>
				)}

				{event.data.type === "agent-spawn" && (
					<div className="px-4 py-4">
						<div className="flex items-center justify-between mb-3">
							<div className="text-xs font-semibold text-orange-400 uppercase tracking-wider">
								Agent Spawned
							</div>
							{renderCopyIconButton(
								"agent-spawn-description",
								event.data.description,
								"Copy agent spawn description",
							)}
						</div>
						<div className="text-zinc-300 text-sm mb-3">{event.data.description}</div>
						{event.data.model && <div className="text-xs text-zinc-600 mb-3">Model: {event.data.model}</div>}
						<div className="flex items-center justify-between mb-1.5">
							<div className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Prompt</div>
							{renderCopyIconButton("agent-spawn-prompt", event.data.prompt, "Copy agent prompt")}
						</div>
						<MarkdownContent className="text-zinc-300 text-sm leading-relaxed">
							{event.data.prompt}
						</MarkdownContent>
					</div>
				)}

				{event.data.type === "summary" && (
					<div className="px-4 py-4">
						<div className="flex items-center justify-between mb-3">
							<div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Summary</div>
							{renderCopyIconButton("summary", event.data.summary, "Copy summary")}
						</div>
						<MarkdownContent className="text-zinc-400 text-sm leading-relaxed">
							{event.data.summary}
						</MarkdownContent>
					</div>
				)}
			</div>
		</div>
	)
}
