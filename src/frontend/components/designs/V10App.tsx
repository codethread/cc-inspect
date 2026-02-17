import {useCallback, useEffect, useMemo, useRef, useState} from "react"
import type {AgentNode, Event, EventType, SessionData, SessionHandle} from "#types"
import {useCliSession, useDirectories, useSessionData, useSessions} from "../../api"

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
// Turn grouping: group events into conversational "turns"
// A turn starts with a user-message or agent-spawn and includes all
// subsequent events until the next user-message or agent-spawn.
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

function groupIntoTurns(events: Event[]): Turn[] {
	const turns: Turn[] = []
	let current: Turn | null = null

	for (const event of events) {
		const isUserMsg = event.type === "user-message"
		const isSpawn = event.type === "agent-spawn"

		if (isUserMsg || isSpawn) {
			if (current) turns.push(current)
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

			// Update summary from first assistant message in the turn
			if (event.type === "assistant-message" && !current.summary && event.data.type === "assistant-message") {
				current.summary = event.data.text.slice(0, 80)
			}
		}
	}
	if (current) turns.push(current)
	return turns
}

// ---------------------------------------------------------------------------
// Agent color system
// ---------------------------------------------------------------------------

const AGENT_COLORS = [
	{bg: "bg-blue-500/8", border: "border-blue-500/20", text: "text-blue-400", dot: "#60a5fa"},
	{bg: "bg-violet-500/8", border: "border-violet-500/20", text: "text-violet-400", dot: "#a78bfa"},
	{bg: "bg-rose-500/8", border: "border-rose-500/20", text: "text-rose-400", dot: "#fb7185"},
	{bg: "bg-amber-500/8", border: "border-amber-500/20", text: "text-amber-400", dot: "#fbbf24"},
	{bg: "bg-emerald-500/8", border: "border-emerald-500/20", text: "text-emerald-400", dot: "#34d399"},
	{bg: "bg-cyan-500/8", border: "border-cyan-500/20", text: "text-cyan-400", dot: "#22d3ee"},
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
// Outline / Table of Contents
// ---------------------------------------------------------------------------

function Outline({
	turns,
	agents,
	activeTurnId,
	onNavigate,
}: {
	turns: Turn[]
	agents: AgentNode[]
	activeTurnId: string | null
	onNavigate: (turnId: string) => void
}) {
	// Only show user turns and agent spawns in the outline for brevity
	const outlineItems = turns.filter((t) => t.kind === "user" || t.kind === "agent-spawn")

	return (
		<nav className="py-4">
			<div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider px-4 mb-3">Outline</div>
			<div className="space-y-0.5">
				{outlineItems.map((turn, idx) => {
					const colors = getAgentColorSet(agents, turn.agentId)
					const isActive = activeTurnId === turn.id
					return (
						<button
							key={turn.id}
							type="button"
							onClick={() => onNavigate(turn.id)}
							className={`w-full text-left px-4 py-1.5 text-sm transition-colors cursor-pointer flex items-start gap-2 ${
								isActive
									? "bg-zinc-800 text-zinc-100"
									: "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
							}`}
						>
							<span className="flex-shrink-0 mt-1">
								{turn.kind === "user" ? (
									<span className="text-sky-400 font-mono text-xs font-bold">{idx + 1}</span>
								) : (
									<span
										className="w-2 h-2 rounded-full inline-block mt-0.5"
										style={{backgroundColor: colors.dot}}
									/>
								)}
							</span>
							<span className="truncate leading-snug">{turn.summary || "..."}</span>
						</button>
					)
				})}
			</div>
		</nav>
	)
}

// ---------------------------------------------------------------------------
// Filter Drawer (slide-out)
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
					{/* Search */}
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

					{/* Event Types */}
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

					{/* Agents */}
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
												style={{backgroundColor: active ? colors.dot : "#52525b"}}
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
// Event renderers within a turn
// ---------------------------------------------------------------------------

function UserMessageBlock({event}: {event: Event}) {
	if (event.data.type !== "user-message") return null
	return (
		<div className="bg-sky-500/5 border border-sky-500/15 rounded-xl px-5 py-4">
			<div className="flex items-center gap-2 mb-2">
				<span className="text-xs font-semibold text-sky-400 uppercase tracking-wider">User</span>
				<span className="text-xs text-zinc-600">{formatTime(event.timestamp)}</span>
			</div>
			<div className="text-zinc-200 text-[15px] leading-relaxed whitespace-pre-wrap">{event.data.text}</div>
		</div>
	)
}

function AssistantMessageBlock({event}: {event: Event}) {
	if (event.data.type !== "assistant-message") return null
	return (
		<div className="px-1">
			<div className="flex items-center gap-2 mb-1.5">
				<span className="text-xs font-semibold text-violet-400 uppercase tracking-wider">Assistant</span>
				<span className="text-xs text-zinc-600">{formatTime(event.timestamp)}</span>
			</div>
			<div className="text-zinc-200 text-[15px] leading-[1.7] whitespace-pre-wrap">{event.data.text}</div>
		</div>
	)
}

function ThinkingBlock({event, expanded, onToggle}: {event: Event; expanded: boolean; onToggle: () => void}) {
	if (event.data.type !== "thinking") return null
	const content = event.data.content
	const preview = content.slice(0, 120)
	return (
		<div className="px-1">
			<button
				type="button"
				onClick={onToggle}
				className="flex items-center gap-2 text-xs text-fuchsia-400/70 hover:text-fuchsia-400 transition-colors cursor-pointer mb-1"
			>
				<svg
					className={`w-3 h-3 transition-transform ${expanded ? "rotate-90" : ""}`}
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					aria-hidden="true"
				>
					<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
				</svg>
				<span className="font-semibold uppercase tracking-wider">Thinking</span>
				<span className="text-zinc-600">{formatTime(event.timestamp)}</span>
			</button>
			{expanded ? (
				<div className="pl-5 text-zinc-400 text-sm leading-relaxed whitespace-pre-wrap italic">{content}</div>
			) : (
				<div className="pl-5 text-zinc-600 text-sm truncate italic">{preview}...</div>
			)}
		</div>
	)
}

function ToolPairBlock({
	useEvent,
	resultEvent,
	expanded,
	onToggle,
}: {
	useEvent: Event
	resultEvent: Event | null
	expanded: boolean
	onToggle: () => void
}) {
	if (useEvent.data.type !== "tool-use") return null
	const toolName = useEvent.data.toolName
	const input = useEvent.data.description ?? JSON.stringify(useEvent.data.input, null, 2)
	const success = resultEvent?.data.type === "tool-result" ? resultEvent.data.success : null
	const output = resultEvent?.data.type === "tool-result" ? resultEvent.data.output : null

	return (
		<div className="border border-zinc-800 rounded-xl overflow-hidden">
			<button
				type="button"
				onClick={onToggle}
				className="w-full flex items-center gap-3 px-4 py-2.5 bg-zinc-900/50 hover:bg-zinc-800/50 transition-colors cursor-pointer text-left"
			>
				<svg
					className={`w-3 h-3 text-zinc-500 transition-transform flex-shrink-0 ${expanded ? "rotate-90" : ""}`}
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					aria-hidden="true"
				>
					<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
				</svg>
				<span className="text-amber-400 font-mono text-sm font-medium">{toolName}</span>
				{success !== null && (
					<span className={`text-xs font-medium ${success ? "text-emerald-400" : "text-red-400"}`}>
						{success ? "OK" : "ERR"}
					</span>
				)}
				{output !== null && (
					<span className="text-xs text-zinc-600">{output.length.toLocaleString()} chars</span>
				)}
				<span className="text-xs text-zinc-700 ml-auto">{formatTime(useEvent.timestamp)}</span>
			</button>
			{expanded && (
				<div className="border-t border-zinc-800">
					<div className="px-4 py-3">
						<div className="text-xs font-medium text-zinc-500 mb-1.5 uppercase tracking-wider">Input</div>
						<pre className="text-sm text-zinc-300 font-mono whitespace-pre-wrap break-words leading-relaxed max-h-64 overflow-y-auto bg-zinc-950/50 rounded-lg p-3">
							{input}
						</pre>
					</div>
					{output !== null && (
						<div className="px-4 py-3 border-t border-zinc-800/50">
							<div className="text-xs font-medium text-zinc-500 mb-1.5 uppercase tracking-wider">Output</div>
							<pre className="text-sm text-zinc-400 font-mono whitespace-pre-wrap break-words leading-relaxed max-h-80 overflow-y-auto bg-zinc-950/50 rounded-lg p-3">
								{output}
							</pre>
						</div>
					)}
				</div>
			)}
		</div>
	)
}

function AgentSpawnBlock({event}: {event: Event}) {
	if (event.data.type !== "agent-spawn") return null
	return (
		<div className="bg-orange-500/5 border border-orange-500/15 rounded-xl px-5 py-4">
			<div className="flex items-center gap-2 mb-2">
				<span className="text-xs font-semibold text-orange-400 uppercase tracking-wider">Agent Spawned</span>
				<span className="text-xs text-zinc-600">{formatTime(event.timestamp)}</span>
			</div>
			<div className="text-zinc-300 text-sm mb-2">{event.data.description}</div>
			{event.data.model && <div className="text-xs text-zinc-600">Model: {event.data.model}</div>}
		</div>
	)
}

function SummaryBlock({event}: {event: Event}) {
	if (event.data.type !== "summary") return null
	return (
		<div className="bg-zinc-800/30 border border-zinc-700/30 rounded-xl px-5 py-4">
			<div className="flex items-center gap-2 mb-2">
				<span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Summary</span>
				<span className="text-xs text-zinc-600">{formatTime(event.timestamp)}</span>
			</div>
			<div className="text-zinc-400 text-sm leading-relaxed whitespace-pre-wrap">{event.data.summary}</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Turn component
// ---------------------------------------------------------------------------

function TurnView({
	turn,
	agents,
	allEvents,
	turnRef,
}: {
	turn: Turn
	agents: AgentNode[]
	allEvents: Event[]
	turnRef?: React.RefObject<HTMLDivElement | null>
}) {
	const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
	const colors = getAgentColorSet(agents, turn.agentId)

	const toggleExpanded = useCallback((id: string) => {
		setExpandedIds((prev) => {
			const next = new Set(prev)
			if (next.has(id)) next.delete(id)
			else next.add(id)
			return next
		})
	}, [])

	// Build a map of tool-use ID -> tool-result for pairing
	const toolResultMap = useMemo(() => {
		const map = new Map<string, Event>()
		for (const e of allEvents) {
			if (e.data.type === "tool-result") {
				map.set(e.data.toolUseId, e)
			}
		}
		return map
	}, [allEvents])

	// Track which tool-result IDs are already shown via pairing
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

	return (
		<div ref={turnRef} className="scroll-mt-16">
			{/* Agent indicator for multi-agent sessions */}
			{agents.length > 1 && (
				<div className="flex items-center gap-2 mb-2">
					<span className="w-2 h-2 rounded-full" style={{backgroundColor: colors.dot}} />
					<span className={`text-xs font-medium ${colors.text}`}>
						{turn.agentName ?? turn.agentId?.slice(0, 10) ?? "main"}
					</span>
				</div>
			)}

			{/* Events in this turn */}
			<div className="space-y-4">
				{turn.events.map((event) => {
					// Skip tool-results that are already paired with a tool-use
					if (pairedResultIds.has(event.id)) return null
					const d = event.data

					switch (d.type) {
						case "user-message":
							return <UserMessageBlock key={event.id} event={event} />
						case "assistant-message":
							return <AssistantMessageBlock key={event.id} event={event} />
						case "thinking":
							return (
								<ThinkingBlock
									key={event.id}
									event={event}
									expanded={expandedIds.has(event.id)}
									onToggle={() => toggleExpanded(event.id)}
								/>
							)
						case "tool-use":
							return (
								<ToolPairBlock
									key={event.id}
									useEvent={event}
									resultEvent={toolResultMap.get(d.toolId) ?? null}
									expanded={expandedIds.has(event.id)}
									onToggle={() => toggleExpanded(event.id)}
								/>
							)
						case "tool-result":
							// Unpaired tool-result (no matching tool-use in this turn)
							return (
								<div key={event.id} className="border border-zinc-800 rounded-xl px-4 py-3">
									<div className="flex items-center gap-2 mb-1">
										<span
											className={`text-xs font-semibold ${d.success ? "text-emerald-400" : "text-red-400"}`}
										>
											{d.success ? "Result (OK)" : "Result (ERR)"}
										</span>
										<span className="text-xs text-zinc-600">{formatTime(event.timestamp)}</span>
									</div>
									<pre className="text-sm text-zinc-400 font-mono whitespace-pre-wrap break-words leading-relaxed max-h-48 overflow-y-auto">
										{d.output.slice(0, 500)}
									</pre>
								</div>
							)
						case "agent-spawn":
							return <AgentSpawnBlock key={event.id} event={event} />
						case "summary":
							return <SummaryBlock key={event.id} event={event} />
						default:
							return null
					}
				})}
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
}

function matchesFilters(event: Event, criteria: FilterCriteria): boolean {
	if (criteria.typeFilter.size > 0 && !criteria.typeFilter.has(event.type)) return false
	if (criteria.agentFilter.size > 0 && !criteria.agentFilter.has(event.agentId ?? "")) return false
	if (criteria.search) {
		const q = criteria.search.toLowerCase()
		const text = getEventText(event).toLowerCase()
		const agent = (event.agentName ?? "").toLowerCase()
		if (!text.includes(q) && !agent.includes(q) && !event.type.includes(q)) return false
	}
	return true
}

function getEventText(event: Event): string {
	switch (event.data.type) {
		case "user-message":
			return event.data.text
		case "assistant-message":
			return event.data.text
		case "tool-use":
			return event.data.toolName + (event.data.description ?? "")
		case "tool-result":
			return event.data.output.slice(0, 200)
		case "thinking":
			return event.data.content.slice(0, 200)
		case "agent-spawn":
			return event.data.description
		case "summary":
			return event.data.summary
	}
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
	const [activeTurnId, setActiveTurnId] = useState<string | null>(null)
	const [showOutline, setShowOutline] = useState(true)

	const agents = useMemo(() => (sessionData ? collectAgents(sessionData.mainAgent) : []), [sessionData])

	const filteredEvents = useMemo(
		() =>
			sessionData
				? sessionData.allEvents.filter((e) => matchesFilters(e, {search, typeFilter, agentFilter}))
				: [],
		[sessionData, search, typeFilter, agentFilter],
	)

	const turns = useMemo(() => groupIntoTurns(filteredEvents), [filteredEvents])

	const turnRefs = useRef<Map<string, HTMLDivElement | null>>(new Map())

	// Update URL
	useEffect(() => {
		const params = new URLSearchParams(window.location.search)
		if (sessionPath) params.set("session", sessionPath)
		else params.delete("session")
		const newUrl = `${window.location.pathname}${params.toString() ? `?${params}` : ""}`
		window.history.replaceState({}, "", newUrl)
	}, [sessionPath])

	// Escape closes filter drawer
	useEffect(() => {
		function handleKey(e: KeyboardEvent) {
			if (e.key === "Escape" && filterOpen) {
				setFilterOpen(false)
				e.preventDefault()
			}
		}
		document.addEventListener("keydown", handleKey)
		return () => document.removeEventListener("keydown", handleKey)
	}, [filterOpen])

	// Intersection observer to track active turn
	useEffect(() => {
		// Reference turns.length to re-observe when turns change
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
	}, [])

	const isFiltered = search || typeFilter.size > 0 || agentFilter.size > 0

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
							onClick={() => setFilterOpen(true)}
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

			{/* Body */}
			<div className="flex-1 flex min-h-0">
				{/* Outline sidebar */}
				{sessionData && showOutline && (
					<aside className="w-64 flex-shrink-0 overflow-y-auto border-r border-zinc-800/50 bg-zinc-950">
						<Outline turns={turns} agents={agents} activeTurnId={activeTurnId} onNavigate={handleNavigate} />
					</aside>
				)}

				{/* Main reading area */}
				<main className="flex-1 overflow-y-auto min-w-0">
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
						<div className="max-w-3xl mx-auto px-6 py-8 space-y-10">
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
							{turns.map((turn) => (
								<div
									key={turn.id}
									data-turn-id={turn.id}
									ref={(el) => {
										turnRefs.current.set(turn.id, el)
									}}
								>
									<TurnView turn={turn} agents={agents} allEvents={sessionData.allEvents} />
								</div>
							))}

							{/* Bottom spacer */}
							<div className="h-32" />
						</div>
					)}
				</main>
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
			/>
		</div>
	)
}
