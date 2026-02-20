import {useCallback, useEffect, useMemo, useRef, useState} from "react"
import type {AgentNode, Event, EventType, SessionData, SessionHandle} from "#types"
import {useCliSession, useDirectories, useSessionData, useSessions} from "../../api"
import {MarkdownContent} from "../MarkdownContent"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EVENT_TYPES: EventType[] = [
	"user-message",
	"assistant-message",
	"tool-use",
	"tool-result",
	"thinking",
	"agent-spawn",
	"summary",
]

function collectAgents(node: AgentNode): AgentNode[] {
	const result: AgentNode[] = [node]
	for (const child of node.children) result.push(...collectAgents(child))
	return result
}

function formatTime(date: Date): string {
	return date.toLocaleTimeString("en-US", {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	})
}

function formatDateTime(date: Date): string {
	return `${date.toLocaleDateString("en-US", {month: "short", day: "numeric"})} ${formatTime(date)}`
}

// ---------------------------------------------------------------------------
// Smart event summaries (#6)
// ---------------------------------------------------------------------------

function getToolUseSummary(event: Event): string {
	if (event.data.type !== "tool-use") return ""
	const {toolName, description, input} = event.data
	if (description) return `${toolName}: ${description}`

	const inp = input as Record<string, unknown>
	switch (toolName) {
		case "Read":
			if (inp.file_path) return `Read ${String(inp.file_path)}`
			break
		case "Bash":
			if (inp.command) {
				const cmd = String(inp.command)
				return `Bash: ${cmd.length > 80 ? `${cmd.slice(0, 80)}...` : cmd}`
			}
			break
		case "Edit":
		case "Write":
			if (inp.file_path) return `${toolName} ${String(inp.file_path)}`
			break
		case "Grep":
			if (inp.pattern) return `Grep: ${String(inp.pattern)}`
			break
		case "Glob":
			if (inp.pattern) return `Glob: ${String(inp.pattern)}`
			break
		case "WebSearch":
			if (inp.query) return `Search: ${String(inp.query)}`
			break
		case "WebFetch":
			if (inp.url) return `Fetch: ${String(inp.url)}`
			break
	}
	return toolName
}

function getToolResultSummary(event: Event): string {
	if (event.data.type !== "tool-result") return ""
	const prefix = event.data.success ? "OK" : "ERR"
	const output = event.data.output
	const firstLine = output.split("\n")[0] ?? ""
	const preview = firstLine.length > 100 ? `${firstLine.slice(0, 100)}...` : firstLine
	return preview ? `${prefix}: ${preview}` : `${prefix} (${output.length.toLocaleString()} chars)`
}

function getEventSummary(event: Event): string {
	switch (event.data.type) {
		case "user-message":
			return event.data.text.slice(0, 120)
		case "assistant-message":
			return event.data.text.slice(0, 120)
		case "tool-use":
			return getToolUseSummary(event)
		case "tool-result":
			return getToolResultSummary(event)
		case "thinking":
			return event.data.content.slice(0, 80)
		case "agent-spawn":
			return event.data.description
		case "summary":
			return event.data.summary.slice(0, 120)
	}
}

function getEventSearchableText(event: Event): string {
	const parts = [getEventSummary(event), event.agentName ?? "", event.type]
	if (event.data.type === "tool-use") {
		for (const value of Object.values(event.data.input)) {
			if (typeof value === "string") parts.push(value)
			else if (value != null) parts.push(JSON.stringify(value))
		}
	}
	return parts.join(" ").toLowerCase()
}

// ---------------------------------------------------------------------------
// Turn grouping
// ---------------------------------------------------------------------------

interface Turn {
	id: string
	kind: "user" | "assistant" | "agent-spawn"
	agentId: string | null
	agentName: string | null
	timestamp: Date
	events: Event[]
	summary: string
}

// Group events per agent first so that tool-use/result pairs from the same agent
// always land in the same turn, even when parallel agents interleave in allEvents.
// Sort turns by the position of their first event in the original events array —
// that array is already timestamp-sorted by the server, and integer index comparison
// avoids any Date rehydration / NaN issues.
//
// Task tool-results (data.agentId set) live in allEvents with agentId = subagentId
// (from entry.agentId in the JSONL), but logically belong to the main agent's flow.
// We route them to the main agent bucket so they pair with their Task tool-uses and
// don't create orphaned "0 tool calls" blocks in subagent sections.
function groupIntoTurns(events: Event[], mainAgentId: string): Turn[] {
	const eventIndex = new Map<string, number>()
	events.forEach((e, i) => eventIndex.set(e.id, i))

	const byAgent = new Map<string | null, Event[]>()
	for (const event of events) {
		const isTaskResult = event.data.type === "tool-result" && Boolean(event.data.agentId)
		const key = isTaskResult ? mainAgentId : event.agentId
		const list = byAgent.get(key)
		if (list) list.push(event)
		else byAgent.set(key, [event])
	}

	const allTurns: Turn[] = []
	for (const agentEvents of byAgent.values()) {
		allTurns.push(...buildAgentTurns(agentEvents, mainAgentId))
	}

	return allTurns.sort((a, b) => {
		const aIdx = eventIndex.get(a.events[0]?.id ?? "") ?? 0
		const bIdx = eventIndex.get(b.events[0]?.id ?? "") ?? 0
		return aIdx - bIdx
	})
}

// Builds turns for a single agent's event list.
// For the main agent, splits after a batch of Task tool-results so subagent sections
// can interleave chronologically: task-uses + task-results stay in the same pre-split
// turn (keeping accordion pairing intact), and the main agent's continuation
// (thinking/assistant) starts a new turn whose sort position falls after subagents.
function buildAgentTurns(events: Event[], mainAgentId: string): Turn[] {
	const turns: Turn[] = []
	let current: Turn | null = null
	let pendingTaskResultSplit = false

	for (const event of events) {
		const isUserMsg = event.type === "user-message"
		const isSpawn = event.type === "agent-spawn"
		const isTaskResult = event.data.type === "tool-result" && Boolean(event.data.agentId)

		if (isUserMsg || isSpawn) {
			if (current) turns.push(current)
			pendingTaskResultSplit = false
			current = {
				id: event.id,
				kind: isUserMsg ? "user" : "agent-spawn",
				agentId: event.agentId,
				agentName: event.agentName,
				timestamp: event.timestamp,
				events: [event],
				summary:
					isUserMsg && event.data.type === "user-message"
						? event.data.text.slice(0, 80)
						: isSpawn && event.data.type === "agent-spawn"
							? `Agent: ${event.data.description}`
							: "",
			}
		} else {
			// After a batch of Task tool-results, split when the first non-task-result
			// arrives. This keeps task-use/result pairs together in the pre-split turn
			// and starts a new main-agent turn whose sort position falls after subagents.
			if (pendingTaskResultSplit && !isTaskResult && current && event.agentId === mainAgentId) {
				turns.push(current)
				current = null
				pendingTaskResultSplit = false
			}

			if (isTaskResult) pendingTaskResultSplit = true

			if (!current) {
				current = {
					id: event.id,
					kind: "assistant",
					agentId: event.agentId,
					agentName: event.agentName,
					timestamp: event.timestamp,
					events: [],
					summary: "",
				}
			}
			current.events.push(event)

			if (event.type === "assistant-message" && !current.summary && event.data.type === "assistant-message") {
				current.summary = event.data.text.slice(0, 80)
			}
		}
	}
	if (current) turns.push(current)
	return turns
}

// ---------------------------------------------------------------------------
// Tool call grouping for accordion (#7)
// Consecutive tool-use/tool-result events are grouped together.
// ---------------------------------------------------------------------------

interface ToolCallGroup {
	kind: "tool-group"
	events: Event[]
	toolNames: string[]
}

interface SingleEvent {
	kind: "single"
	event: Event
}

type TimelineItem = ToolCallGroup | SingleEvent

function groupTurnEvents(turnEvents: Event[], pairedResultIds: Set<string>): TimelineItem[] {
	const items: TimelineItem[] = []
	let currentGroup: ToolCallGroup | null = null

	for (const event of turnEvents) {
		if (pairedResultIds.has(event.id)) continue

		const isToolEvent = event.type === "tool-use" || event.type === "tool-result"

		if (isToolEvent) {
			if (!currentGroup) {
				currentGroup = {kind: "tool-group", events: [], toolNames: []}
			}
			currentGroup.events.push(event)
			if (event.type === "tool-use" && event.data.type === "tool-use") {
				currentGroup.toolNames.push(event.data.toolName)
			}
		} else {
			if (currentGroup) {
				items.push(currentGroup)
				currentGroup = null
			}
			items.push({kind: "single", event})
		}
	}
	if (currentGroup) items.push(currentGroup)
	return items
}

// ---------------------------------------------------------------------------
// Agent color system
// ---------------------------------------------------------------------------

const AGENT_COLORS = [
	{
		bg: "bg-blue-500/8",
		border: "border-blue-500/20",
		text: "text-blue-400",
		dot: "#60a5fa",
	},
	{
		bg: "bg-violet-500/8",
		border: "border-violet-500/20",
		text: "text-violet-400",
		dot: "#a78bfa",
	},
	{
		bg: "bg-rose-500/8",
		border: "border-rose-500/20",
		text: "text-rose-400",
		dot: "#fb7185",
	},
	{
		bg: "bg-amber-500/8",
		border: "border-amber-500/20",
		text: "text-amber-400",
		dot: "#fbbf24",
	},
	{
		bg: "bg-emerald-500/8",
		border: "border-emerald-500/20",
		text: "text-emerald-400",
		dot: "#34d399",
	},
	{
		bg: "bg-cyan-500/8",
		border: "border-cyan-500/20",
		text: "text-cyan-400",
		dot: "#22d3ee",
	},
] as const

function getAgentColorSet(agents: AgentNode[], agentId: string | null) {
	const idx = agents.findIndex((a) => a.id === agentId)
	const safeIdx = (idx >= 0 ? idx : 0) % AGENT_COLORS.length
	return AGENT_COLORS[safeIdx] ?? AGENT_COLORS[0]
}

// ---------------------------------------------------------------------------
// Session Picker
// ---------------------------------------------------------------------------

function SessionPicker({
	sessionData,
	onSelect,
}: {
	sessionData: SessionData | null
	onSelect: (path: string) => void
}) {
	const [open, setOpen] = useState(false)
	const [dir, setDir] = useState("")
	const {data: directories = []} = useDirectories()
	const {data: sessions = [], isLoading} = useSessions(dir)
	const ref = useRef<HTMLDivElement>(null)

	useEffect(() => {
		if (!open) return
		function handleClick(e: MouseEvent) {
			if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
		}
		function handleKey(e: KeyboardEvent) {
			if (e.key === "Escape") setOpen(false)
		}
		document.addEventListener("mousedown", handleClick)
		document.addEventListener("keydown", handleKey)
		return () => {
			document.removeEventListener("mousedown", handleClick)
			document.removeEventListener("keydown", handleKey)
		}
	}, [open])

	return (
		<div ref={ref} className="relative">
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
			>
				<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeWidth={1.5}
						d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
					/>
				</svg>
				{sessionData ? (
					<span className="font-mono text-xs">{sessionData.sessionId.slice(0, 14)}</span>
				) : (
					<span>Open session</span>
				)}
			</button>
			{open && (
				<div className="absolute top-full left-0 mt-2 w-80 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl z-50 overflow-hidden">
					<div className="p-3 border-b border-zinc-800">
						<select
							className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200"
							value={dir}
							onChange={(e) => setDir(e.target.value)}
						>
							<option value="">Select project...</option>
							{directories.map((d) => (
								<option key={d} value={d}>
									{d}
								</option>
							))}
						</select>
					</div>
					<div className="max-h-60 overflow-y-auto">
						{isLoading && dir && <div className="p-3 text-sm text-zinc-500">Loading...</div>}
						{!dir && <div className="p-3 text-sm text-zinc-600">Choose a project first</div>}
						{dir && !isLoading && sessions.length === 0 && (
							<div className="p-3 text-sm text-zinc-600">No sessions</div>
						)}
						{sessions.map((s: SessionHandle) => (
							<button
								key={s.sessionFilePath}
								type="button"
								onClick={() => {
									onSelect(s.sessionFilePath)
									setOpen(false)
								}}
								className="w-full text-left px-3 py-2 hover:bg-zinc-800 text-sm text-zinc-300 border-b border-zinc-800/50 last:border-0 transition-colors cursor-pointer"
							>
								<span className="font-mono text-xs text-zinc-500">{s.id.slice(0, 14)}</span>
							</button>
						))}
					</div>
				</div>
			)}
		</div>
	)
}

// ---------------------------------------------------------------------------
// Outline (#1) - hierarchical: real user messages top-level, sub-agent indented
// ---------------------------------------------------------------------------

function Outline({
	turns,
	agents,
	mainAgentId,
	activeTurnId,
	onNavigate,
}: {
	turns: Turn[]
	agents: AgentNode[]
	mainAgentId: string
	activeTurnId: string | null
	onNavigate: (turnId: string) => void
}) {
	const outlineItems = turns.filter((t) => t.kind === "user" || t.kind === "agent-spawn")

	let userMsgIndex = 0

	return (
		<nav className="py-4">
			<div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider px-4 mb-3">Outline</div>
			<div className="space-y-0.5">
				{outlineItems.map((turn) => {
					const isRealUser = turn.kind === "user" && turn.agentId === mainAgentId
					const isSpawn = turn.kind === "agent-spawn"
					const isSubAgentUser = turn.kind === "user" && turn.agentId !== mainAgentId
					const colors = getAgentColorSet(agents, turn.agentId)
					const isActive = activeTurnId === turn.id

					if (isRealUser) {
						userMsgIndex++
					}

					return (
						<button
							key={turn.id}
							type="button"
							onClick={() => onNavigate(turn.id)}
							className={`w-full text-left py-1.5 text-sm transition-colors cursor-pointer flex items-start gap-2 ${
								isSubAgentUser || isSpawn ? "pl-8 pr-4" : "px-4"
							} ${
								isActive
									? "bg-zinc-800 text-zinc-100"
									: "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
							}`}
						>
							<span className="flex-shrink-0 mt-0.5">
								{isRealUser ? (
									<span className="text-sky-400 font-mono text-xs font-bold">{userMsgIndex}</span>
								) : isSpawn ? (
									<span
										className="w-2 h-2 rounded-full inline-block mt-0.5"
										style={{backgroundColor: colors.dot}}
									/>
								) : (
									<span className="text-zinc-600 font-mono text-xs">&rsaquo;</span>
								)}
							</span>
							<span className={`truncate leading-snug ${isSubAgentUser || isSpawn ? "text-xs" : ""}`}>
								{turn.summary || "..."}
							</span>
						</button>
					)
				})}
			</div>
		</nav>
	)
}

// ---------------------------------------------------------------------------
// Filter Drawer
// ---------------------------------------------------------------------------

function FilterDrawer({
	open,
	onClose,
	agents,
	search,
	onSearchChange,
	typeFilter,
	onTypeFilterChange,
	agentFilter,
	onAgentFilterChange,
	errorsOnly,
	onErrorsOnlyChange,
	errorCount,
}: {
	open: boolean
	onClose: () => void
	agents: AgentNode[]
	search: string
	onSearchChange: (s: string) => void
	typeFilter: Set<EventType>
	onTypeFilterChange: (s: Set<EventType>) => void
	agentFilter: Set<string>
	onAgentFilterChange: (s: Set<string>) => void
	errorsOnly: boolean
	onErrorsOnlyChange: (v: boolean) => void
	errorCount: number
}) {
	useEffect(() => {
		if (!open) return
		function handleKey(e: KeyboardEvent) {
			if (e.key === "Escape") onClose()
		}
		document.addEventListener("keydown", handleKey)
		return () => document.removeEventListener("keydown", handleKey)
	}, [open, onClose])

	const toggleType = (t: EventType) => {
		const next = new Set(typeFilter)
		if (next.has(t)) next.delete(t)
		else next.add(t)
		onTypeFilterChange(next)
	}

	const toggleAgent = (id: string) => {
		const next = new Set(agentFilter)
		if (next.has(id)) next.delete(id)
		else next.add(id)
		onAgentFilterChange(next)
	}

	const typeLabels: Record<EventType, string> = {
		"user-message": "User Messages",
		"assistant-message": "Assistant Messages",
		"tool-use": "Tool Calls",
		"tool-result": "Tool Results",
		thinking: "Thinking",
		"agent-spawn": "Agent Spawns",
		summary: "Summaries",
	}

	if (!open) return null

	return (
		<>
			<button
				type="button"
				className="fixed inset-0 bg-black/40 z-40 cursor-default"
				onClick={onClose}
				aria-label="Close filters"
			/>
			<div className="fixed top-0 right-0 bottom-0 w-80 bg-zinc-900 border-l border-zinc-700 z-50 flex flex-col shadow-2xl">
				<div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
					<span className="text-sm font-semibold text-zinc-200">Filters</span>
					<button
						type="button"
						onClick={onClose}
						className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
					>
						<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				</div>
				<div className="flex-1 overflow-y-auto p-4 space-y-6">
					<label className="block">
						<span className="block text-xs font-medium text-zinc-400 mb-1.5">Search</span>
						<input
							type="text"
							value={search}
							onChange={(e) => onSearchChange(e.target.value)}
							placeholder="Filter by text..."
							className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors"
						/>
					</label>

					{errorCount > 0 && (
						<div>
							<span className="block text-xs font-medium text-zinc-400 mb-2">Errors</span>
							<button
								type="button"
								onClick={() => onErrorsOnlyChange(!errorsOnly)}
								className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors cursor-pointer ${
									errorsOnly
										? "bg-red-500/10 text-red-400 border border-red-500/25"
										: "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 border border-transparent"
								}`}
							>
								<span className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0" />
								Show only failures ({errorCount})
							</button>
						</div>
					)}

					<div>
						<span className="block text-xs font-medium text-zinc-400 mb-2">Event Types</span>
						<div className="space-y-1">
							{EVENT_TYPES.map((t) => {
								const active = typeFilter.size === 0 || typeFilter.has(t)
								return (
									<button
										key={t}
										type="button"
										onClick={() => toggleType(t)}
										className={`w-full text-left px-3 py-1.5 rounded-lg text-sm transition-colors cursor-pointer ${
											active ? "bg-zinc-800 text-zinc-200" : "text-zinc-600 hover:text-zinc-400"
										}`}
									>
										{typeLabels[t]}
									</button>
								)
							})}
						</div>
					</div>

					{agents.length > 1 && (
						<div>
							<span className="block text-xs font-medium text-zinc-400 mb-2">Agents</span>
							<div className="space-y-1">
								{agents.map((a) => {
									const colors = getAgentColorSet(agents, a.id)
									const active = agentFilter.size === 0 || agentFilter.has(a.id)
									return (
										<button
											key={a.id}
											type="button"
											onClick={() => toggleAgent(a.id)}
											className={`w-full text-left px-3 py-1.5 rounded-lg text-sm flex items-center gap-2 transition-colors cursor-pointer ${
												active ? "bg-zinc-800 text-zinc-200" : "text-zinc-600 hover:text-zinc-400"
											}`}
										>
											<span
												className="w-2.5 h-2.5 rounded-full flex-shrink-0"
												style={{
													backgroundColor: active ? colors.dot : "#52525b",
												}}
											/>
											{a.name ?? a.id.slice(0, 12)}
										</button>
									)
								})}
							</div>
						</div>
					)}
				</div>
			</div>
		</>
	)
}

// ---------------------------------------------------------------------------
// Search Modal (⌘K)
// ---------------------------------------------------------------------------

const EVENT_TYPE_LABEL: Record<EventType, string> = {
	"user-message": "user",
	"assistant-message": "assistant",
	"tool-use": "tool-use",
	"tool-result": "result",
	thinking: "thinking",
	"agent-spawn": "spawn",
	summary: "summary",
}

const EVENT_TYPE_COLOR: Record<EventType, string> = {
	"user-message": "text-sky-400",
	"assistant-message": "text-violet-400",
	"tool-use": "text-amber-400",
	"tool-result": "text-emerald-400",
	thinking: "text-fuchsia-400",
	"agent-spawn": "text-orange-400",
	summary: "text-zinc-500",
}

function SearchModal({
	events,
	agents,
	onGoToTimeline,
	onClose,
}: {
	events: Event[]
	agents: AgentNode[]
	onGoToTimeline: (event: Event) => void
	onClose: () => void
}) {
	const [query, setQuery] = useState("")
	const [selectedIndex, setSelectedIndex] = useState(0)
	const [typeFilter, setTypeFilter] = useState<Set<EventType>>(new Set())
	const inputRef = useRef<HTMLInputElement>(null)
	const listRef = useRef<HTMLDivElement>(null)

	const toggleType = (type: EventType) => {
		const next = new Set(typeFilter)
		if (next.has(type)) next.delete(type)
		else next.add(type)
		setTypeFilter(next)
	}

	const results = useMemo(() => {
		if (!query.trim()) return []
		const q = query.toLowerCase()
		return events
			.filter((e) => {
				if (typeFilter.size > 0 && !typeFilter.has(e.type)) return false
				return getEventSearchableText(e).includes(q)
			})
			.slice(0, 300)
	}, [events, query, typeFilter])

	// Clamp selection to valid range; effectively resets to 0 when results shrink
	const boundedIndex = results.length > 0 ? Math.min(selectedIndex, results.length - 1) : 0
	const previewEvent = results[boundedIndex] ?? null

	// Focus input on mount
	useEffect(() => {
		inputRef.current?.focus()
	}, [])

	// Scroll selected row into view
	useEffect(() => {
		const list = listRef.current
		if (!list) return
		const el = list.children[boundedIndex] as HTMLElement | undefined
		el?.scrollIntoView({block: "nearest"})
	}, [boundedIndex])

	useEffect(() => {
		function handleKey(e: KeyboardEvent) {
			if (e.key === "Escape") {
				onClose()
			} else if (e.key === "ArrowDown") {
				e.preventDefault()
				setSelectedIndex((i) => Math.min(i + 1, results.length - 1))
			} else if (e.key === "ArrowUp") {
				e.preventDefault()
				setSelectedIndex((i) => Math.max(i - 1, 0))
			} else if (e.key === "Enter" && previewEvent) {
				e.preventDefault()
				onGoToTimeline(previewEvent)
				onClose()
			}
		}
		document.addEventListener("keydown", handleKey)
		return () => document.removeEventListener("keydown", handleKey)
	}, [results, previewEvent, onGoToTimeline, onClose])

	return (
		<>
			{/* Backdrop */}
			<button
				type="button"
				className="fixed inset-0 bg-black/60 z-50 cursor-default backdrop-blur-sm"
				onClick={onClose}
				aria-label="Close search"
			/>
			{/* Modal: two-panel layout */}
			<div
				className="fixed left-1/2 top-[10%] -translate-x-1/2 w-[1000px] max-w-[calc(100vw-1rem)] z-50 bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl flex overflow-hidden"
				style={{maxHeight: "78vh"}}
			>
				{/* Left panel: search + results */}
				<div className="w-80 flex-shrink-0 flex flex-col border-r border-zinc-800">
					{/* Search input */}
					<div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800 flex-shrink-0">
						<svg
							className="w-4 h-4 text-zinc-500 flex-shrink-0"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							aria-hidden="true"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
							/>
						</svg>
						<input
							ref={inputRef}
							type="text"
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							placeholder="Search events..."
							className="flex-1 bg-transparent text-zinc-100 placeholder-zinc-600 text-sm focus:outline-none"
						/>
						<kbd className="text-xs text-zinc-600 bg-zinc-800 px-1.5 py-0.5 rounded font-mono flex-shrink-0">
							esc
						</kbd>
					</div>

					{/* Type filter chips */}
					<div className="flex flex-wrap gap-1.5 px-4 py-2.5 border-b border-zinc-800 flex-shrink-0">
						{EVENT_TYPES.map((type) => {
							const on = typeFilter.has(type)
							return (
								<button
									key={type}
									type="button"
									onClick={() => toggleType(type)}
									className={`px-2 py-0.5 rounded text-xs font-mono transition-opacity cursor-pointer ${EVENT_TYPE_COLOR[type]} ${
										typeFilter.size === 0
											? "opacity-40 hover:opacity-70"
											: on
												? "opacity-100 ring-1 ring-current"
												: "opacity-20 hover:opacity-40"
									}`}
								>
									{EVENT_TYPE_LABEL[type]}
								</button>
							)
						})}
					</div>

					{/* Column headers */}
					{results.length > 0 && (
						<div className="flex items-center gap-2 px-4 py-1.5 border-b border-zinc-800/60 flex-shrink-0">
							<span className="text-xs text-zinc-600 uppercase tracking-wider w-16 flex-shrink-0">Time</span>
							<span className="text-xs text-zinc-600 uppercase tracking-wider w-16 flex-shrink-0">Type</span>
							<span className="text-xs text-zinc-600 uppercase tracking-wider flex-1">Match</span>
						</div>
					)}

					{/* Results list */}
					<div ref={listRef} className="flex-1 overflow-y-auto min-h-0">
						{!query.trim() && (
							<div className="px-4 py-10 text-center text-zinc-700 text-sm">Type to search all events</div>
						)}
						{query.trim() && results.length === 0 && (
							<div className="px-4 py-10 text-center text-zinc-600 text-sm">No events match</div>
						)}
						{results.map((event, i) => {
							const isSelected = i === boundedIndex
							const colors = getAgentColorSet(agents, event.agentId)
							return (
								<button
									key={event.id}
									type="button"
									onClick={() => setSelectedIndex(i)}
									onMouseEnter={() => setSelectedIndex(i)}
									className={`w-full text-left flex items-center gap-2 px-4 py-2 border-b border-zinc-800/50 last:border-0 transition-colors cursor-pointer ${
										isSelected ? "bg-zinc-800" : "hover:bg-zinc-800/50"
									}`}
								>
									<span className="text-xs text-zinc-600 font-mono tabular-nums flex-shrink-0 w-16">
										{formatTime(event.timestamp)}
									</span>
									<span className={`text-xs font-mono flex-shrink-0 w-16 ${EVENT_TYPE_COLOR[event.type]}`}>
										{EVENT_TYPE_LABEL[event.type]}
									</span>
									{agents.length > 1 && (
										<span
											className="w-1.5 h-1.5 rounded-full flex-shrink-0"
											style={{backgroundColor: colors.dot}}
										/>
									)}
									<span className="text-zinc-400 text-xs truncate">{getEventSummary(event)}</span>
								</button>
							)
						})}
					</div>

					{/* Footer: count + keyboard hints */}
					<div className="flex items-center gap-2 px-4 py-2 border-t border-zinc-800 flex-shrink-0">
						<span className="text-xs text-zinc-600">
							{query.trim() && results.length > 0
								? `${results.length} result${results.length !== 1 ? "s" : ""}`
								: ""}
						</span>
						<div className="flex items-center gap-1.5 ml-auto text-xs text-zinc-600">
							<kbd className="bg-zinc-800 px-1.5 py-0.5 rounded font-mono">↑↓</kbd>
							<kbd className="bg-zinc-800 px-1.5 py-0.5 rounded font-mono">↵</kbd>
							<span>timeline</span>
						</div>
					</div>
				</div>

				{/* Right panel: detail view */}
				<div className="flex-1 min-w-0 min-h-0 flex flex-col">
					{previewEvent ? (
						<DetailPanel
							event={previewEvent}
							allEvents={events}
							agents={agents}
							onNavigate={() => {
								onGoToTimeline(previewEvent)
								onClose()
							}}
						/>
					) : (
						<div className="flex-1 flex items-center justify-center bg-zinc-950 border-l border-zinc-800">
							<div className="text-center px-8">
								<div className="text-zinc-600 text-sm mb-1">No event selected</div>
								<div className="text-zinc-700 text-xs">Type to search, then navigate results</div>
							</div>
						</div>
					)}
				</div>
			</div>
		</>
	)
}

// ---------------------------------------------------------------------------
// Detail Panel (#5) - always visible on the right
// ---------------------------------------------------------------------------

function DetailPanel({
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

	// Build linked tool-result/tool-use
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
				{/* User message */}
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

				{/* Assistant message */}
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

				{/* Thinking */}
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

				{/* Tool use */}
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

				{/* Tool result */}
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

				{/* Agent spawn */}
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

				{/* Summary */}
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

// ---------------------------------------------------------------------------
// Timeline event blocks (#4, #7)
// Messages are truncated to 3 lines, click opens detail panel.
// Tool calls are grouped into accordions.
// ---------------------------------------------------------------------------

function UserMessageBlock({
	event,
	isActive,
	onClick,
}: {
	event: Event
	isActive: boolean
	onClick: () => void
}) {
	if (event.data.type !== "user-message") return null
	return (
		<button
			type="button"
			onClick={onClick}
			className={`w-full text-left bg-sky-500/5 border rounded-xl px-5 py-4 transition-colors cursor-pointer ${
				isActive ? "border-sky-400/40 ring-1 ring-sky-400/20" : "border-sky-500/15 hover:border-sky-500/30"
			}`}
			data-event-id={event.id}
		>
			<div className="flex items-center gap-2 mb-2">
				<span className="text-xs font-semibold text-sky-400 uppercase tracking-wider">User</span>
				<span className="text-xs text-zinc-600">{formatTime(event.timestamp)}</span>
			</div>
			<div className="text-zinc-200 text-sm leading-relaxed line-clamp-3">{event.data.text}</div>
		</button>
	)
}

function AssistantMessageBlock({
	event,
	isActive,
	onClick,
}: {
	event: Event
	isActive: boolean
	onClick: () => void
}) {
	if (event.data.type !== "assistant-message") return null
	return (
		<button
			type="button"
			onClick={onClick}
			className={`w-full text-left px-1 py-1 rounded-lg transition-colors cursor-pointer ${
				isActive ? "bg-zinc-800/50 ring-1 ring-violet-400/20" : "hover:bg-zinc-800/30"
			}`}
			data-event-id={event.id}
		>
			<div className="flex items-center gap-2 mb-1.5 px-1">
				<span className="text-xs font-semibold text-violet-400 uppercase tracking-wider">Assistant</span>
				<span className="text-xs text-zinc-600">{formatTime(event.timestamp)}</span>
			</div>
			<div className="text-zinc-200 text-sm leading-relaxed line-clamp-3 px-1">{event.data.text}</div>
		</button>
	)
}

function ThinkingBlock({event, isActive, onClick}: {event: Event; isActive: boolean; onClick: () => void}) {
	if (event.data.type !== "thinking") return null
	return (
		<button
			type="button"
			onClick={onClick}
			className={`w-full text-left px-1 py-1 rounded-lg transition-colors cursor-pointer ${
				isActive ? "bg-zinc-800/50 ring-1 ring-fuchsia-400/20" : "hover:bg-zinc-800/30"
			}`}
			data-event-id={event.id}
		>
			<div className="flex items-center gap-2 mb-1 px-1">
				<span className="text-xs font-semibold text-fuchsia-400/70 uppercase tracking-wider">Thinking</span>
				<span className="text-xs text-zinc-600">{formatTime(event.timestamp)}</span>
			</div>
			<div className="pl-1 text-zinc-600 text-sm truncate italic">{event.data.content.slice(0, 120)}</div>
		</button>
	)
}

function AgentSpawnBlock({event, isActive, onClick}: {event: Event; isActive: boolean; onClick: () => void}) {
	if (event.data.type !== "agent-spawn") return null
	return (
		<button
			type="button"
			onClick={onClick}
			className={`w-full text-left bg-orange-500/5 border rounded-xl px-5 py-4 transition-colors cursor-pointer ${
				isActive
					? "border-orange-400/40 ring-1 ring-orange-400/20"
					: "border-orange-500/15 hover:border-orange-500/30"
			}`}
			data-event-id={event.id}
		>
			<div className="flex items-center gap-2 mb-2">
				<span className="text-xs font-semibold text-orange-400 uppercase tracking-wider">Agent Spawned</span>
				<span className="text-xs text-zinc-600">{formatTime(event.timestamp)}</span>
			</div>
			<div className="text-zinc-300 text-sm">{event.data.description}</div>
		</button>
	)
}

function SummaryBlock({event, isActive, onClick}: {event: Event; isActive: boolean; onClick: () => void}) {
	if (event.data.type !== "summary") return null
	return (
		<button
			type="button"
			onClick={onClick}
			className={`w-full text-left bg-zinc-800/30 border rounded-xl px-5 py-4 transition-colors cursor-pointer ${
				isActive ? "border-zinc-600 ring-1 ring-zinc-500/20" : "border-zinc-700/30 hover:border-zinc-700"
			}`}
			data-event-id={event.id}
		>
			<div className="flex items-center gap-2 mb-2">
				<span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Summary</span>
				<span className="text-xs text-zinc-600">{formatTime(event.timestamp)}</span>
			</div>
			<div className="text-zinc-400 text-sm leading-relaxed line-clamp-3">{event.data.summary}</div>
		</button>
	)
}

// ---------------------------------------------------------------------------
// Tool call accordion (#7)
// ---------------------------------------------------------------------------

function ToolGroupAccordion({
	group,
	toolResultMap,
	selectedEventId,
	onSelectEvent,
}: {
	group: ToolCallGroup
	toolResultMap: Map<string, Event>
	selectedEventId: string | null
	onSelectEvent: (event: Event) => void
}) {
	const [expanded, setExpanded] = useState(false)

	const summaryText =
		group.toolNames.length <= 3
			? group.toolNames.join(", ")
			: `${group.toolNames.slice(0, 3).join(", ")} +${group.toolNames.length - 3}`

	// Count failures in this group
	const failureCount = group.events.reduce((count, e) => {
		if (e.data.type === "tool-use") {
			const result = toolResultMap.get(e.data.toolId)
			if (result?.data.type === "tool-result" && !result.data.success) return count + 1
		}
		return count
	}, 0)
	const hasFailures = failureCount > 0

	return (
		<div
			className={`border rounded-xl overflow-hidden ${hasFailures ? "border-red-500/30" : "border-zinc-800"}`}
		>
			<button
				type="button"
				onClick={() => setExpanded(!expanded)}
				className={`w-full flex items-center gap-3 px-4 py-2.5 hover:bg-zinc-800/50 transition-colors cursor-pointer text-left ${
					hasFailures ? "bg-red-500/5" : "bg-zinc-900/50"
				}`}
			>
				<svg
					className={`w-3 h-3 transition-transform flex-shrink-0 ${expanded ? "rotate-90" : ""} ${
						hasFailures ? "text-red-400" : "text-zinc-500"
					}`}
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					aria-hidden="true"
				>
					<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
				</svg>
				{hasFailures && <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />}
				<span className={`font-mono text-xs font-medium ${hasFailures ? "text-red-400" : "text-amber-400"}`}>
					{group.toolNames.length} tool call
					{group.toolNames.length !== 1 ? "s" : ""}
				</span>
				<span className="text-zinc-500 text-xs truncate">{summaryText}</span>
				{hasFailures && (
					<span className="text-red-400 text-xs flex-shrink-0 font-medium">{failureCount} failed</span>
				)}
			</button>
			{expanded && (
				<div className={`border-t ${hasFailures ? "border-red-500/20" : "border-zinc-800"}`}>
					{group.events.map((event) => {
						if (event.type === "tool-result") return null
						const isActive = event.id === selectedEventId
						const summary = getEventSummary(event)
						const result = event.data.type === "tool-use" ? toolResultMap.get(event.data.toolId) : null
						const success = result?.data.type === "tool-result" ? result.data.success : null
						const isFailed = success === false

						return (
							<button
								key={event.id}
								type="button"
								onClick={() => onSelectEvent(event)}
								className={`w-full text-left flex items-center gap-3 px-4 py-2 border-b last:border-0 transition-colors cursor-pointer ${
									isFailed
										? `border-l-2 border-l-red-400 bg-red-500/5 border-b-red-500/10 ${isActive ? "bg-red-500/10" : "hover:bg-red-500/8"}`
										: `border-l-2 border-l-transparent border-b-zinc-800/50 ${isActive ? "bg-zinc-800/80" : "hover:bg-zinc-800/40"}`
								}`}
								data-event-id={event.id}
							>
								<span
									className={`font-mono text-xs font-medium flex-shrink-0 ${isFailed ? "text-red-400" : "text-amber-400"}`}
								>
									{event.data.type === "tool-use" ? event.data.toolName : "result"}
								</span>
								{success !== null && (
									<span
										className={`text-xs flex-shrink-0 ${success ? "text-emerald-400" : "text-red-400 font-semibold"}`}
									>
										{success ? "OK" : "ERR"}
									</span>
								)}
								<span className="text-zinc-500 text-xs truncate">{summary}</span>
								<span className="text-xs text-zinc-700 ml-auto flex-shrink-0 tabular-nums">
									{formatTime(event.timestamp)}
								</span>
							</button>
						)
					})}
				</div>
			)}
		</div>
	)
}

// ---------------------------------------------------------------------------
// Subagent section grouping
// ---------------------------------------------------------------------------

interface MainTurnSection {
	kind: "main"
	turn: Turn
}

interface SubagentSection {
	kind: "subagent"
	agentId: string
	agent: AgentNode | null
	turns: Turn[]
}

type TurnSection = MainTurnSection | SubagentSection

function groupTurnsIntoSections(turns: Turn[], mainAgentId: string, agents: AgentNode[]): TurnSection[] {
	const sections: TurnSection[] = []
	let current: SubagentSection | null = null

	for (const turn of turns) {
		const isMain = turn.agentId === mainAgentId || turn.agentId == null

		if (isMain) {
			if (current) {
				sections.push(current)
				current = null
			}
			sections.push({kind: "main", turn})
		} else {
			const agentId = turn.agentId
			if (current && current.agentId === agentId) {
				current.turns.push(turn)
			} else {
				if (current) sections.push(current)
				const agent = agents.find((a) => a.id === agentId) ?? null
				current = {kind: "subagent", agentId, agent, turns: [turn]}
			}
		}
	}
	if (current) sections.push(current)
	return sections
}

// ---------------------------------------------------------------------------
// Turn view (reworked)
// ---------------------------------------------------------------------------

function TurnView({
	turn,
	agents,
	allEvents,
	selectedEventId,
	onSelectEvent,
	hideAgentLabel,
}: {
	turn: Turn
	agents: AgentNode[]
	allEvents: Event[]
	selectedEventId: string | null
	onSelectEvent: (event: Event) => void
	hideAgentLabel?: boolean
}) {
	const colors = getAgentColorSet(agents, turn.agentId)

	const toolResultMap = useMemo(() => {
		const map = new Map<string, Event>()
		for (const e of allEvents) {
			if (e.data.type === "tool-result") {
				map.set(e.data.toolUseId, e)
			}
		}
		return map
	}, [allEvents])

	const pairedResultIds = useMemo(() => {
		const ids = new Set<string>()
		for (const e of turn.events) {
			if (e.data.type === "tool-use") {
				const result = toolResultMap.get(e.data.toolId)
				if (result) ids.add(result.id)
			}
		}
		return ids
	}, [turn.events, toolResultMap])

	const timelineItems = useMemo(
		() => groupTurnEvents(turn.events, pairedResultIds),
		[turn.events, pairedResultIds],
	)

	return (
		<div className="scroll-mt-16">
			{!hideAgentLabel && agents.length > 1 && (
				<div className="flex items-center gap-2 mb-2">
					<span className="w-2 h-2 rounded-full" style={{backgroundColor: colors.dot}} />
					<span className={`text-xs font-medium ${colors.text}`}>
						{turn.agentName ?? turn.agentId?.slice(0, 10) ?? "main"}
					</span>
				</div>
			)}

			<div className="space-y-3">
				{timelineItems.map((item) => {
					if (item.kind === "tool-group") {
						return (
							<ToolGroupAccordion
								key={item.events[0]?.id ?? "tg"}
								group={item}
								toolResultMap={toolResultMap}
								selectedEventId={selectedEventId}
								onSelectEvent={onSelectEvent}
							/>
						)
					}

					const event = item.event
					const isActive = event.id === selectedEventId

					switch (event.data.type) {
						case "user-message":
							return (
								<UserMessageBlock
									key={event.id}
									event={event}
									isActive={isActive}
									onClick={() => onSelectEvent(event)}
								/>
							)
						case "assistant-message":
							return (
								<AssistantMessageBlock
									key={event.id}
									event={event}
									isActive={isActive}
									onClick={() => onSelectEvent(event)}
								/>
							)
						case "thinking":
							return (
								<ThinkingBlock
									key={event.id}
									event={event}
									isActive={isActive}
									onClick={() => onSelectEvent(event)}
								/>
							)
						case "agent-spawn":
							return (
								<AgentSpawnBlock
									key={event.id}
									event={event}
									isActive={isActive}
									onClick={() => onSelectEvent(event)}
								/>
							)
						case "summary":
							return (
								<SummaryBlock
									key={event.id}
									event={event}
									isActive={isActive}
									onClick={() => onSelectEvent(event)}
								/>
							)
						case "tool-use":
						case "tool-result": {
							// Stray tool events not in a group
							const isError = event.data.type === "tool-result" && !event.data.success
							return (
								<button
									key={event.id}
									type="button"
									onClick={() => onSelectEvent(event)}
									className={`w-full text-left px-4 py-2 rounded-lg text-sm transition-colors cursor-pointer ${
										isError
											? `bg-red-500/5 border border-red-500/20 text-red-300 ${isActive ? "ring-1 ring-red-400/30" : "hover:bg-red-500/8"}`
											: `text-zinc-400 ${isActive ? "bg-zinc-800/50 ring-1 ring-zinc-600" : "hover:bg-zinc-800/30"}`
									}`}
									data-event-id={event.id}
								>
									<span className="flex items-center gap-2">
										{isError && <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />}
										{getEventSummary(event)}
									</span>
								</button>
							)
						}
						default:
							return null
					}
				})}
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Subagent section view
// ---------------------------------------------------------------------------

function SubagentSectionView({
	section,
	agents,
	allEvents,
	selectedEventId,
	onSelectEvent,
	turnRefs,
}: {
	section: SubagentSection
	agents: AgentNode[]
	allEvents: Event[]
	selectedEventId: string | null
	onSelectEvent: (event: Event) => void
	turnRefs: {current: Map<string, HTMLDivElement | null>}
}) {
	const colors = getAgentColorSet(agents, section.agentId)
	const agent = section.agent
	const label =
		[agent?.description, agent?.name, agent?.subagentType].find((s) => s?.trim()) ??
		section.agentId.slice(0, 12)

	return (
		<div className={`ml-3 pl-4 border rounded-xl py-4 pr-4 ${colors.bg} ${colors.border}`}>
			{/* Subagent header */}
			<div className="flex items-center gap-2 mb-4">
				<span className="w-2 h-2 rounded-full flex-shrink-0" style={{backgroundColor: colors.dot}} />
				<span className={`text-xs font-semibold uppercase tracking-wide ${colors.text}`}>{label}</span>
			</div>

			<div className="space-y-8">
				{section.turns.map((turn) => (
					<div
						key={turn.id}
						data-turn-id={turn.id}
						ref={(el) => {
							turnRefs.current.set(turn.id, el)
						}}
					>
						<TurnView
							turn={turn}
							agents={agents}
							allEvents={allEvents}
							selectedEventId={selectedEventId}
							onSelectEvent={onSelectEvent}
							hideAgentLabel
						/>
					</div>
				))}
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Filtering logic
// ---------------------------------------------------------------------------

interface FilterCriteria {
	search: string
	typeFilter: Set<EventType>
	agentFilter: Set<string>
	errorsOnly: boolean
	failedToolUseIds: Set<string>
}

function matchesFilters(event: Event, criteria: FilterCriteria): boolean {
	if (criteria.errorsOnly) {
		const isFailedResult = event.data.type === "tool-result" && !event.data.success
		const isLinkedToolUse = event.data.type === "tool-use" && criteria.failedToolUseIds.has(event.data.toolId)
		if (!isFailedResult && !isLinkedToolUse) return false
	}
	if (criteria.typeFilter.size > 0 && !criteria.typeFilter.has(event.type)) return false
	if (criteria.agentFilter.size > 0 && !criteria.agentFilter.has(event.agentId ?? "")) return false
	if (criteria.search) {
		const q = criteria.search.toLowerCase()
		if (!getEventSearchableText(event).includes(q)) return false
	}
	return true
}

// ---------------------------------------------------------------------------
// Main V10 App
// ---------------------------------------------------------------------------

export function V10App() {
	const [sessionPath, setSessionPath] = useState(() => {
		const params = new URLSearchParams(window.location.search)
		return params.get("session") ?? ""
	})
	const {data: sessionDataFromPath} = useSessionData(sessionPath)
	const {data: cliSession} = useCliSession()
	const sessionData = sessionPath ? (sessionDataFromPath ?? null) : (cliSession ?? null)

	const [search, setSearch] = useState("")
	const [typeFilter, setTypeFilter] = useState<Set<EventType>>(new Set())
	const [agentFilter, setAgentFilter] = useState<Set<string>>(new Set())
	const [filterOpen, setFilterOpen] = useState(false)
	const [searchOpen, setSearchOpen] = useState(false)
	const [activeTurnId, setActiveTurnId] = useState<string | null>(null)
	const [showOutline, setShowOutline] = useState(true)
	const [selectedEvent, setSelectedEvent] = useState<Event | null>(null)
	const [errorsOnly, setErrorsOnly] = useState(false)

	const agents = useMemo(() => (sessionData ? collectAgents(sessionData.mainAgent) : []), [sessionData])
	const mainAgentId = sessionData?.mainAgent.id ?? ""

	// Pre-compute error-related data from the full session
	const {errorCount, failedToolUseIds} = useMemo(() => {
		if (!sessionData) return {errorCount: 0, failedToolUseIds: new Set<string>()}
		let count = 0
		const ids = new Set<string>()
		for (const e of sessionData.allEvents) {
			if (e.data.type === "tool-result" && !e.data.success) {
				count++
				ids.add(e.data.toolUseId)
			}
		}
		return {errorCount: count, failedToolUseIds: ids}
	}, [sessionData])

	const filteredEvents = useMemo(
		() =>
			sessionData
				? sessionData.allEvents.filter((e) =>
						matchesFilters(e, {
							search,
							typeFilter,
							agentFilter,
							errorsOnly,
							failedToolUseIds,
						}),
					)
				: [],
		[sessionData, search, typeFilter, agentFilter, errorsOnly, failedToolUseIds],
	)

	const turns = useMemo(() => groupIntoTurns(filteredEvents, mainAgentId), [filteredEvents, mainAgentId])

	const turnRefs = useRef<Map<string, HTMLDivElement | null>>(new Map())
	const timelineRef = useRef<HTMLElement | null>(null)

	// Pinned event: scroll back to it after filter changes (#2)
	const pinnedEventIdRef = useRef<string | null>(null)
	const prevFilterKeyRef = useRef("")

	// Pending scroll from search select: resolved after turns re-render.
	// Tool events may not have data-event-id in DOM (accordions collapsed), so
	// fall back to the containing turn element.
	const pendingScrollToRef = useRef<string | null>(null)

	// After turns update, try to scroll to the pending search-selected event.
	// Falls back to the turn that owns the event when the specific element isn't
	// in the DOM (e.g. tool events inside collapsed accordions, or tool-results
	// which are excluded from timeline rendering).
	useEffect(() => {
		const eventId = pendingScrollToRef.current
		if (!eventId) return
		const eventEl = timelineRef.current?.querySelector(`[data-event-id="${eventId}"]`)
		if (eventEl) {
			eventEl.scrollIntoView({behavior: "smooth", block: "center"})
			pendingScrollToRef.current = null
			return
		}
		for (const turn of turns) {
			if (turn.events.some((e) => e.id === eventId)) {
				turnRefs.current.get(turn.id)?.scrollIntoView({behavior: "smooth", block: "start"})
				pendingScrollToRef.current = null
				break
			}
		}
	}, [turns])

	const filterKey = `${search}|${[...typeFilter].join(",")}|${[...agentFilter].join(",")}|${errorsOnly}`
	if (prevFilterKeyRef.current !== filterKey) {
		const changed = prevFilterKeyRef.current !== ""
		prevFilterKeyRef.current = filterKey
		if (changed && pinnedEventIdRef.current) {
			requestAnimationFrame(() => {
				const el = timelineRef.current?.querySelector(`[data-event-id="${pinnedEventIdRef.current}"]`)
				if (el) {
					el.scrollIntoView({behavior: "smooth", block: "center"})
				}
			})
		}
	}

	// Update URL
	useEffect(() => {
		const params = new URLSearchParams(window.location.search)
		if (sessionPath) params.set("session", sessionPath)
		else params.delete("session")
		const newUrl = `${window.location.pathname}${params.toString() ? `?${params}` : ""}`
		window.history.replaceState({}, "", newUrl)
	}, [sessionPath])

	// Global keyboard shortcuts
	useEffect(() => {
		function handleKey(e: KeyboardEvent) {
			if ((e.metaKey || e.ctrlKey) && e.key === "k") {
				if (!sessionData) return
				e.preventDefault()
				setFilterOpen(false)
				setSearchOpen(true)
			} else if (e.key === "Escape") {
				if (searchOpen) {
					setSearchOpen(false)
					e.preventDefault()
				} else if (filterOpen) {
					setFilterOpen(false)
					e.preventDefault()
				} else if (selectedEvent) {
					setSelectedEvent(null)
					pinnedEventIdRef.current = null
					e.preventDefault()
				}
			}
		}
		document.addEventListener("keydown", handleKey)
		return () => document.removeEventListener("keydown", handleKey)
	}, [sessionData, searchOpen, filterOpen, selectedEvent])

	// Intersection observer to track active turn
	useEffect(() => {
		const _turnCount = turns.length
		if (_turnCount === 0) return

		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						setActiveTurnId(entry.target.getAttribute("data-turn-id"))
					}
				}
			},
			{rootMargin: "-80px 0px -60% 0px", threshold: 0},
		)
		for (const [, el] of turnRefs.current) {
			if (el) observer.observe(el)
		}
		return () => observer.disconnect()
	}, [turns])

	const handleNavigate = useCallback((turnId: string) => {
		const el = turnRefs.current.get(turnId)
		if (el) {
			el.scrollIntoView({behavior: "smooth", block: "start"})
			setActiveTurnId(turnId)
		}
	}, [])

	const handleSelectSession = useCallback((path: string) => {
		setSessionPath(path)
		setActiveTurnId(null)
		setSelectedEvent(null)
		pinnedEventIdRef.current = null
	}, [])

	const handleSelectEvent = useCallback((event: Event) => {
		setSelectedEvent(event)
		pinnedEventIdRef.current = event.id
	}, [])

	// Select from search modal: clear filters so the event is guaranteed visible,
	// then use pendingScrollToRef so the post-turns-render effect can scroll —
	// falling back to turn-level scroll for events not in the DOM (collapsed
	// accordions, tool-results excluded from rendering).
	const handleSearchSelect = useCallback((event: Event) => {
		setSearch("")
		setTypeFilter(new Set())
		setAgentFilter(new Set())
		setErrorsOnly(false)
		setSelectedEvent(event)
		pinnedEventIdRef.current = event.id
		pendingScrollToRef.current = event.id
	}, [])

	const isFiltered = search || typeFilter.size > 0 || agentFilter.size > 0 || errorsOnly

	return (
		<div className="h-screen flex flex-col bg-zinc-950 text-zinc-200">
			{/* Header */}
			<header className="flex items-center gap-4 px-6 py-3 bg-zinc-900/80 border-b border-zinc-800 flex-shrink-0 backdrop-blur-sm">
				<span className="text-sm font-semibold text-zinc-100 tracking-tight">cc-inspect</span>
				<span className="text-xs text-zinc-600 font-mono">v10</span>
				<div className="w-px h-4 bg-zinc-800" />
				<SessionPicker sessionData={sessionData} onSelect={handleSelectSession} />

				<div className="flex-1" />

				{sessionData && (
					<>
						<span className="text-xs text-zinc-600 tabular-nums">
							{filteredEvents.length}
							{isFiltered ? ` / ${sessionData.allEvents.length}` : ""} events
						</span>
						{errorCount > 0 && (
							<button
								type="button"
								onClick={() => setErrorsOnly(!errorsOnly)}
								className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
									errorsOnly
										? "bg-red-500/15 text-red-400 border border-red-500/30"
										: "text-red-400/60 hover:text-red-400 hover:bg-red-500/5 border border-transparent"
								}`}
								title={errorsOnly ? "Show all events" : "Show only errors"}
							>
								<span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
								{errorCount} error{errorCount !== 1 ? "s" : ""}
							</button>
						)}
						<button
							type="button"
							onClick={() => setSearchOpen(true)}
							className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 transition-colors cursor-pointer text-xs"
							title="Search events (⌘K)"
						>
							<svg
								className="w-3.5 h-3.5"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
								aria-hidden="true"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
								/>
							</svg>
							<kbd className="font-mono">⌘K</kbd>
						</button>
						<button
							type="button"
							onClick={() => setShowOutline(!showOutline)}
							className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
								showOutline ? "bg-zinc-800 text-zinc-300" : "text-zinc-600 hover:text-zinc-400"
							}`}
							title="Toggle outline"
						>
							<svg
								className="w-4 h-4"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
								aria-hidden="true"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={1.5}
									d="M4 6h16M4 12h10M4 18h14"
								/>
							</svg>
						</button>
						<button
							type="button"
							onClick={() => {
								setSearchOpen(false)
								setFilterOpen(true)
							}}
							className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
								isFiltered ? "bg-zinc-800 text-amber-400" : "text-zinc-600 hover:text-zinc-400"
							}`}
							title="Filters"
						>
							<svg
								className="w-4 h-4"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
								aria-hidden="true"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={1.5}
									d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
								/>
							</svg>
						</button>
					</>
				)}

				<a href="/v1" className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors">
					designs
				</a>
			</header>

			{/* Body: [outline] [timeline] [detail panel] */}
			<div className="flex-1 flex min-h-0">
				{/* Outline sidebar */}
				{sessionData && showOutline && (
					<aside className="w-60 flex-shrink-0 overflow-y-auto border-r border-zinc-800/50 bg-zinc-950">
						<Outline
							turns={turns}
							agents={agents}
							mainAgentId={mainAgentId}
							activeTurnId={activeTurnId}
							onNavigate={handleNavigate}
						/>
					</aside>
				)}

				{/* Timeline (center) */}
				<main ref={timelineRef} className="flex-1 overflow-y-auto min-w-0">
					{!sessionData && (
						<div className="flex items-center justify-center h-full">
							<div className="text-center">
								<div className="text-zinc-600 text-sm mb-1">No session loaded</div>
								<div className="text-zinc-700 text-xs">Open a session to begin reading</div>
							</div>
						</div>
					)}

					{sessionData && turns.length === 0 && (
						<div className="flex items-center justify-center h-full">
							<div className="text-zinc-600 text-sm">No events match current filters</div>
						</div>
					)}

					{sessionData && turns.length > 0 && (
						<div className="max-w-3xl mx-auto px-6 py-8 space-y-8">
							{/* Session header */}
							<div className="border-b border-zinc-800 pb-6 mb-2">
								<h1 className="text-lg font-semibold text-zinc-100 mb-1">
									Session {sessionData.sessionId.slice(0, 14)}
								</h1>
								<div className="flex items-center gap-4 text-xs text-zinc-600">
									<span>{formatDateTime(sessionData.allEvents[0]?.timestamp ?? new Date())}</span>
									<span>{sessionData.allEvents.length} events</span>
									<span>
										{agents.length} agent{agents.length > 1 ? "s" : ""}
									</span>
								</div>
							</div>

							{/* Turns */}
							{groupTurnsIntoSections(turns, mainAgentId, agents).map((section) => {
								if (section.kind === "main") {
									const turn = section.turn
									return (
										<div
											key={turn.id}
											data-turn-id={turn.id}
											ref={(el) => {
												turnRefs.current.set(turn.id, el)
											}}
										>
											<TurnView
												turn={turn}
												agents={agents}
												allEvents={sessionData.allEvents}
												selectedEventId={selectedEvent?.id ?? null}
												onSelectEvent={handleSelectEvent}
											/>
										</div>
									)
								}
								return (
									<SubagentSectionView
										key={`${section.agentId}-${section.turns[0]?.id}`}
										section={section}
										agents={agents}
										allEvents={sessionData.allEvents}
										selectedEventId={selectedEvent?.id ?? null}
										onSelectEvent={handleSelectEvent}
										turnRefs={turnRefs}
									/>
								)
							})}

							<div className="h-32" />
						</div>
					)}
				</main>

				{/* Detail panel (always visible) (#5) */}
				{sessionData && (
					<aside className="w-[450px] flex-shrink-0 min-h-0">
						<DetailPanel event={selectedEvent} allEvents={sessionData.allEvents} agents={agents} />
					</aside>
				)}
			</div>

			{/* Filter drawer */}
			<FilterDrawer
				open={filterOpen}
				onClose={() => setFilterOpen(false)}
				agents={agents}
				search={search}
				onSearchChange={setSearch}
				typeFilter={typeFilter}
				onTypeFilterChange={setTypeFilter}
				agentFilter={agentFilter}
				onAgentFilterChange={setAgentFilter}
				errorsOnly={errorsOnly}
				onErrorsOnlyChange={setErrorsOnly}
				errorCount={errorCount}
			/>

			{/* Search modal (⌘K) */}
			{searchOpen && sessionData && (
				<SearchModal
					events={sessionData.allEvents}
					agents={agents}
					onGoToTimeline={handleSearchSelect}
					onClose={() => setSearchOpen(false)}
				/>
			)}
		</div>
	)
}
