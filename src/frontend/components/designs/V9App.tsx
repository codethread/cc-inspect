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

function formatTs(date: Date): string {
	return date.toLocaleTimeString("en-US", {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	})
}

function formatTsFull(date: Date): string {
	return date.toLocaleTimeString("en-US", {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		fractionalSecondDigits: 3,
		hour12: false,
	})
}

function eventTypeLabel(type: EventType): string {
	const map: Record<EventType, string> = {
		"user-message": "USER",
		"assistant-message": "ASST",
		"tool-use": "TOOL",
		"tool-result": "RSLT",
		thinking: "THNK",
		"agent-spawn": "SPWN",
		summary: "SUMM",
	}
	return map[type]
}

function typeAccentColor(type: EventType): string {
	const map: Record<EventType, string> = {
		"user-message": "text-sky-400",
		"assistant-message": "text-violet-400",
		"tool-use": "text-amber-400",
		"tool-result": "text-emerald-400",
		thinking: "text-fuchsia-400",
		"agent-spawn": "text-orange-400",
		summary: "text-slate-400",
	}
	return map[type]
}

function typeBgColor(type: EventType): string {
	const map: Record<EventType, string> = {
		"user-message": "bg-sky-500/10",
		"assistant-message": "bg-violet-500/10",
		"tool-use": "bg-amber-500/10",
		"tool-result": "bg-emerald-500/10",
		thinking: "bg-fuchsia-500/10",
		"agent-spawn": "bg-orange-500/10",
		summary: "bg-slate-500/10",
	}
	return map[type]
}

function typeBorderColor(type: EventType): string {
	const map: Record<EventType, string> = {
		"user-message": "border-sky-500/30",
		"assistant-message": "border-violet-500/30",
		"tool-use": "border-amber-500/30",
		"tool-result": "border-emerald-500/30",
		thinking: "border-fuchsia-500/30",
		"agent-spawn": "border-orange-500/30",
		summary: "border-slate-500/30",
	}
	return map[type]
}

function eventOneLiner(event: Event): string {
	switch (event.data.type) {
		case "user-message":
			return event.data.text.slice(0, 140)
		case "assistant-message":
			return event.data.text.slice(0, 140)
		case "tool-use":
			return event.data.toolName + (event.data.description ? ` - ${event.data.description}` : "")
		case "tool-result":
			return `${event.data.success ? "OK" : "ERR"} (${event.data.output.length} chars)`
		case "thinking":
			return event.data.content.slice(0, 140)
		case "agent-spawn":
			return event.data.description
		case "summary":
			return event.data.summary.slice(0, 140)
	}
}

function eventFullContent(event: Event): string {
	switch (event.data.type) {
		case "user-message":
			return event.data.text
		case "assistant-message":
			return event.data.text
		case "tool-use":
			return event.data.description ?? JSON.stringify(event.data.input, null, 2)
		case "tool-result":
			return event.data.output
		case "thinking":
			return event.data.content
		case "agent-spawn":
			return event.data.prompt
		case "summary":
			return event.data.summary
	}
}

const AGENT_PALETTE = [
	"#60a5fa",
	"#a78bfa",
	"#f472b6",
	"#fb923c",
	"#34d399",
	"#38bdf8",
	"#facc15",
	"#c084fc",
] as const

function getAgentColor(agents: AgentNode[], agentId: string | null): string {
	const idx = agents.findIndex((a) => a.id === agentId)
	return AGENT_PALETTE[idx >= 0 ? idx % AGENT_PALETTE.length : 0] as string
}

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
		const text = eventOneLiner(event).toLowerCase()
		const agent = (event.agentName ?? "").toLowerCase()
		if (!text.includes(q) && !agent.includes(q) && !event.type.includes(q)) return false
	}
	return true
}

// ---------------------------------------------------------------------------
// Session Picker (compact popover)
// ---------------------------------------------------------------------------

function SessionPicker({
	sessionData,
	onSelectSession,
}: {
	sessionData: SessionData | null
	onSelectSession: (path: string) => void
}) {
	const [open, setOpen] = useState(false)
	const [dir, setDir] = useState("")
	const {data: directories = []} = useDirectories()
	const {data: sessions = [], isLoading: loadingSessions} = useSessions(dir)
	const ref = useRef<HTMLDivElement>(null)

	useEffect(() => {
		function handleClick(e: MouseEvent) {
			if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
		}
		if (open) document.addEventListener("mousedown", handleClick)
		return () => document.removeEventListener("mousedown", handleClick)
	}, [open])

	useEffect(() => {
		if (!open) return
		function handleKey(e: KeyboardEvent) {
			if (e.key === "Escape") setOpen(false)
		}
		document.addEventListener("keydown", handleKey)
		return () => document.removeEventListener("keydown", handleKey)
	}, [open])

	return (
		<div ref={ref} className="relative">
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="flex items-center gap-2 px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 text-sm text-slate-200 transition-colors cursor-pointer"
			>
				<svg
					className="w-4 h-4 text-slate-400"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					aria-hidden="true"
				>
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeWidth={2}
						d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
					/>
				</svg>
				<span className="max-w-[200px] truncate">
					{sessionData ? sessionData.sessionId.slice(0, 12) : "Select session"}
				</span>
				<svg
					className="w-3 h-3 text-slate-500"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					aria-hidden="true"
				>
					<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
				</svg>
			</button>
			{open && (
				<div className="absolute top-full left-0 mt-1 w-80 bg-slate-800 border border-slate-600 rounded-lg shadow-2xl z-50 overflow-hidden">
					<div className="p-3 border-b border-slate-700">
						<label className="block text-xs text-slate-400 mb-1 font-medium">
							Project
							<select
								className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-200 mt-1"
								value={dir}
								onChange={(e) => setDir(e.target.value)}
							>
								<option value="">Choose project...</option>
								{directories.map((d) => (
									<option key={d} value={d}>
										{d}
									</option>
								))}
							</select>
						</label>
					</div>
					<div className="max-h-64 overflow-y-auto">
						{loadingSessions && dir && <div className="p-3 text-sm text-slate-400">Loading sessions...</div>}
						{!dir && <div className="p-3 text-sm text-slate-500">Select a project first</div>}
						{dir && !loadingSessions && sessions.length === 0 && (
							<div className="p-3 text-sm text-slate-500">No sessions found</div>
						)}
						{sessions.map((s: SessionHandle) => (
							<button
								key={s.sessionFilePath}
								type="button"
								onClick={() => {
									onSelectSession(s.sessionFilePath)
									setOpen(false)
								}}
								className="w-full text-left px-3 py-2 hover:bg-slate-700 text-sm text-slate-300 border-b border-slate-700/50 last:border-0 transition-colors cursor-pointer"
							>
								<span className="font-mono text-xs text-slate-400">{s.id.slice(0, 10)}</span>
							</button>
						))}
					</div>
				</div>
			)}
		</div>
	)
}

// ---------------------------------------------------------------------------
// Filter Bar
// ---------------------------------------------------------------------------

function FilterBar({
	agents,
	search,
	onSearchChange,
	typeFilter,
	onTypeFilterChange,
	agentFilter,
	onAgentFilterChange,
	totalCount,
	filteredCount,
}: {
	agents: AgentNode[]
	search: string
	onSearchChange: (s: string) => void
	typeFilter: Set<EventType>
	onTypeFilterChange: (s: Set<EventType>) => void
	agentFilter: Set<string>
	onAgentFilterChange: (s: Set<string>) => void
	totalCount: number
	filteredCount: number
}) {
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

	const isFiltered = search || typeFilter.size > 0 || agentFilter.size > 0

	return (
		<div className="flex items-center gap-3 px-4 py-2 bg-slate-900/80 border-b border-slate-700/50">
			{/* Search */}
			<div className="relative flex-shrink-0">
				<svg
					className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500"
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
					type="text"
					value={search}
					onChange={(e) => onSearchChange(e.target.value)}
					placeholder="Search..."
					className="w-48 bg-slate-800 border border-slate-600 rounded pl-8 pr-2 py-1 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500/50 focus:ring-1 focus:ring-sky-500/30 transition-colors"
				/>
			</div>

			{/* Separator */}
			<div className="w-px h-5 bg-slate-700" />

			{/* Type filters */}
			<div className="flex items-center gap-1 flex-shrink-0">
				{EVENT_TYPES.map((t) => {
					const active = typeFilter.size === 0 || typeFilter.has(t)
					return (
						<button
							key={t}
							type="button"
							onClick={() => toggleType(t)}
							className={`px-2 py-0.5 rounded text-xs font-mono transition-all cursor-pointer ${
								active
									? `${typeAccentColor(t)} ${typeBgColor(t)} border ${typeBorderColor(t)}`
									: "text-slate-600 bg-slate-800/50 border border-transparent hover:text-slate-400"
							}`}
						>
							{eventTypeLabel(t)}
						</button>
					)
				})}
			</div>

			{/* Separator */}
			{agents.length > 1 && <div className="w-px h-5 bg-slate-700" />}

			{/* Agent filters */}
			{agents.length > 1 && (
				<div className="flex items-center gap-1 overflow-x-auto flex-shrink min-w-0">
					{agents.map((a) => {
						const color = getAgentColor(agents, a.id)
						const active = agentFilter.size === 0 || agentFilter.has(a.id)
						return (
							<button
								key={a.id}
								type="button"
								onClick={() => toggleAgent(a.id)}
								className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-all cursor-pointer whitespace-nowrap ${
									active
										? "bg-slate-700/50 text-slate-200 border border-slate-600"
										: "text-slate-600 bg-slate-800/30 border border-transparent hover:text-slate-400"
								}`}
							>
								<span
									className="w-2 h-2 rounded-full flex-shrink-0"
									style={{backgroundColor: active ? color : "rgb(71 85 105)"}}
								/>
								{a.name ?? a.id.slice(0, 8)}
							</button>
						)
					})}
				</div>
			)}

			{/* Spacer */}
			<div className="flex-1" />

			{/* Count */}
			<span className="text-xs text-slate-500 flex-shrink-0 tabular-nums">
				{isFiltered ? `${filteredCount} / ` : ""}
				{totalCount} events
			</span>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Event Row
// ---------------------------------------------------------------------------

function EventRow({
	event,
	agents,
	isSelected,
	isFocused,
	onClick,
	rowRef,
}: {
	event: Event
	agents: AgentNode[]
	isSelected: boolean
	isFocused: boolean
	onClick: () => void
	rowRef?: React.RefObject<HTMLButtonElement | null>
}) {
	const agentColor = getAgentColor(agents, event.agentId)

	return (
		<button
			ref={rowRef}
			type="button"
			onClick={onClick}
			className={`w-full text-left flex items-center gap-0 px-3 py-1.5 border-b border-slate-800/60 transition-colors cursor-pointer group ${
				isSelected
					? "bg-sky-500/10 border-l-2 border-l-sky-400"
					: isFocused
						? "bg-slate-800/60 border-l-2 border-l-slate-500"
						: "border-l-2 border-l-transparent hover:bg-slate-800/40"
			}`}
		>
			{/* Timestamp */}
			<span className="w-[72px] flex-shrink-0 font-mono text-xs text-slate-500 tabular-nums">
				{formatTs(event.timestamp)}
			</span>

			{/* Type badge */}
			<span
				className={`w-[42px] flex-shrink-0 font-mono text-xs font-semibold ${typeAccentColor(event.type)}`}
			>
				{eventTypeLabel(event.type)}
			</span>

			{/* Agent indicator */}
			<span className="w-[100px] flex-shrink-0 flex items-center gap-1.5 overflow-hidden">
				<span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{backgroundColor: agentColor}} />
				<span className="text-xs text-slate-400 truncate">
					{event.agentName ?? event.agentId?.slice(0, 8) ?? "-"}
				</span>
			</span>

			{/* Summary */}
			<span className="flex-1 text-sm text-slate-300 truncate min-w-0 group-hover:text-slate-100 transition-colors">
				{eventOneLiner(event)}
			</span>
		</button>
	)
}

// ---------------------------------------------------------------------------
// Detail Panel
// ---------------------------------------------------------------------------

function DetailPanel({
	event,
	agents,
	allEvents,
	onClose,
}: {
	event: Event
	agents: AgentNode[]
	allEvents: Event[]
	onClose: () => void
}) {
	const agentColor = getAgentColor(agents, event.agentId)
	const content = eventFullContent(event)

	// For tool-use events, find the matching tool-result
	const toolId = event.data.type === "tool-use" ? event.data.toolId : null
	const linkedResult = toolId
		? allEvents.find((e) => e.data.type === "tool-result" && e.data.toolUseId === toolId)
		: null

	// For tool-result events, find the matching tool-use
	const toolUseId = event.data.type === "tool-result" ? event.data.toolUseId : null
	const linkedUse = toolUseId
		? allEvents.find((e) => e.data.type === "tool-use" && e.data.toolId === toolUseId)
		: null

	return (
		<div className="h-full flex flex-col bg-slate-900 border-l border-slate-700">
			{/* Header */}
			<div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50 flex-shrink-0">
				<div className="flex items-center gap-3 min-w-0">
					<span
						className={`font-mono text-xs font-bold px-2 py-0.5 rounded ${typeBgColor(event.type)} ${typeAccentColor(event.type)} border ${typeBorderColor(event.type)}`}
					>
						{eventTypeLabel(event.type)}
					</span>
					<span className="flex items-center gap-1.5">
						<span className="w-2 h-2 rounded-full" style={{backgroundColor: agentColor}} />
						<span className="text-sm text-slate-300">
							{event.agentName ?? event.agentId?.slice(0, 10) ?? "main"}
						</span>
					</span>
				</div>
				<button
					type="button"
					onClick={onClose}
					className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
					title="Close (Esc)"
				>
					<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
						<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>

			{/* Meta */}
			<div className="px-4 py-2 border-b border-slate-800/50 flex-shrink-0">
				<div className="flex items-center gap-4 text-xs text-slate-500">
					<span className="font-mono tabular-nums">{formatTsFull(event.timestamp)}</span>
					<span>ID: {event.id.slice(0, 12)}</span>
					{event.parentId && <span>Parent: {event.parentId.slice(0, 12)}</span>}
				</div>
				{event.data.type === "tool-use" && (
					<div className="mt-1 text-xs text-slate-400">
						<span className="text-amber-400 font-semibold">{event.data.toolName}</span>
						{event.data.description && <span className="ml-2 text-slate-500">{event.data.description}</span>}
					</div>
				)}
				{event.data.type === "tool-result" && (
					<div className="mt-1 text-xs">
						<span className={event.data.success ? "text-emerald-400" : "text-red-400"}>
							{event.data.success ? "Succeeded" : "Failed"}
						</span>
						<span className="text-slate-500 ml-2">{event.data.output.length.toLocaleString()} chars</span>
					</div>
				)}
			</div>

			{/* Content */}
			<div className="flex-1 overflow-y-auto min-h-0">
				{/* Tool-use: show input as JSON */}
				{event.data.type === "tool-use" && (
					<div className="px-4 py-3">
						<div className="text-xs font-medium text-slate-400 mb-2 uppercase tracking-wider">Input</div>
						<pre className="text-sm text-slate-200 font-mono whitespace-pre-wrap break-words leading-relaxed bg-slate-950/50 rounded-lg p-3 border border-slate-800">
							{JSON.stringify(event.data.input, null, 2)}
						</pre>
					</div>
				)}

				{/* Main content (for non-tool-use, or the description fallback) */}
				{event.data.type !== "tool-use" && (
					<div className="px-4 py-3">
						<pre className="text-sm text-slate-200 whitespace-pre-wrap break-words leading-relaxed font-sans">
							{content}
						</pre>
					</div>
				)}

				{/* Linked tool result */}
				{linkedResult && (
					<div className="px-4 py-3 border-t border-slate-800/50">
						<div className="text-xs font-medium text-emerald-400 mb-2 uppercase tracking-wider">
							Result{" "}
							{linkedResult.data.type === "tool-result" && (linkedResult.data.success ? "(OK)" : "(ERR)")}
						</div>
						<pre className="text-sm text-slate-300 font-mono whitespace-pre-wrap break-words leading-relaxed bg-slate-950/50 rounded-lg p-3 border border-slate-800 max-h-96 overflow-y-auto">
							{linkedResult.data.type === "tool-result" ? linkedResult.data.output : ""}
						</pre>
					</div>
				)}

				{/* Linked tool use */}
				{linkedUse && (
					<div className="px-4 py-3 border-t border-slate-800/50">
						<div className="text-xs font-medium text-amber-400 mb-2 uppercase tracking-wider">
							Tool Call: {linkedUse.data.type === "tool-use" ? linkedUse.data.toolName : ""}
						</div>
						<pre className="text-sm text-slate-300 font-mono whitespace-pre-wrap break-words leading-relaxed bg-slate-950/50 rounded-lg p-3 border border-slate-800 max-h-64 overflow-y-auto">
							{linkedUse.data.type === "tool-use" ? JSON.stringify(linkedUse.data.input, null, 2) : ""}
						</pre>
					</div>
				)}

				{/* Agent spawn details */}
				{event.data.type === "agent-spawn" && (
					<div className="px-4 py-3 border-t border-slate-800/50">
						<div className="text-xs font-medium text-orange-400 mb-2 uppercase tracking-wider">
							Spawn Details
						</div>
						<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
							<dt className="text-slate-500">Agent ID</dt>
							<dd className="text-slate-300 font-mono text-xs">{event.data.agentId}</dd>
							{event.data.model && (
								<>
									<dt className="text-slate-500">Model</dt>
									<dd className="text-slate-300">{event.data.model}</dd>
								</>
							)}
						</dl>
					</div>
				)}
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Main V9 App
// ---------------------------------------------------------------------------

export function V9App() {
	const [sessionPath, setSessionPath] = useState(() => {
		const params = new URLSearchParams(window.location.search)
		return params.get("session") ?? ""
	})
	const {data: sessionDataFromPath} = useSessionData(sessionPath)
	const {data: cliSession} = useCliSession()
	const sessionData = sessionPath ? (sessionDataFromPath ?? null) : (cliSession ?? null)

	const [selectedEvent, setSelectedEvent] = useState<Event | null>(null)
	const [focusedIndex, setFocusedIndex] = useState(-1)
	const [search, setSearch] = useState("")
	const [typeFilter, setTypeFilter] = useState<Set<EventType>>(new Set())
	const [agentFilter, setAgentFilter] = useState<Set<string>>(new Set())

	const agents = useMemo(() => (sessionData ? collectAgents(sessionData.mainAgent) : []), [sessionData])

	const filteredEvents = useMemo(
		() =>
			sessionData
				? sessionData.allEvents.filter((e) => matchesFilters(e, {search, typeFilter, agentFilter}))
				: [],
		[sessionData, search, typeFilter, agentFilter],
	)

	const focusedRef = useRef<HTMLButtonElement | null>(null)
	const listRef = useRef<HTMLDivElement | null>(null)

	// Update URL when session changes
	useEffect(() => {
		const params = new URLSearchParams(window.location.search)
		if (sessionPath) params.set("session", sessionPath)
		else params.delete("session")
		const newUrl = `${window.location.pathname}${params.toString() ? `?${params}` : ""}`
		window.history.replaceState({}, "", newUrl)
	}, [sessionPath])

	// Escape to close detail
	useEffect(() => {
		function handleKey(e: KeyboardEvent) {
			if (e.key === "Escape") {
				if (selectedEvent) {
					setSelectedEvent(null)
					e.preventDefault()
				}
			}
		}
		document.addEventListener("keydown", handleKey)
		return () => document.removeEventListener("keydown", handleKey)
	}, [selectedEvent])

	// Keyboard navigation (arrow keys)
	const handleListKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "ArrowDown") {
				e.preventDefault()
				setFocusedIndex((prev) => Math.min(prev + 1, filteredEvents.length - 1))
			} else if (e.key === "ArrowUp") {
				e.preventDefault()
				setFocusedIndex((prev) => Math.max(prev - 1, 0))
			} else if (e.key === "Enter" && focusedIndex >= 0 && focusedIndex < filteredEvents.length) {
				e.preventDefault()
				setSelectedEvent(filteredEvents[focusedIndex] ?? null)
			}
		},
		[filteredEvents, focusedIndex],
	)

	// Scroll focused row into view when it changes
	const prevFocusedRef = useRef(focusedIndex)
	if (prevFocusedRef.current !== focusedIndex) {
		prevFocusedRef.current = focusedIndex
		// Defer scroll to after render
		requestAnimationFrame(() => {
			focusedRef.current?.scrollIntoView({block: "nearest"})
		})
	}

	// Reset focused index when filtered results change
	const prevFilteredLenRef = useRef(filteredEvents.length)
	if (prevFilteredLenRef.current !== filteredEvents.length) {
		prevFilteredLenRef.current = filteredEvents.length
		setFocusedIndex(-1)
	}

	const handleSelectSession = useCallback((path: string) => {
		setSessionPath(path)
		setSelectedEvent(null)
		setFocusedIndex(-1)
	}, [])

	return (
		<div className="h-screen flex flex-col bg-slate-950 text-slate-200">
			{/* Top bar */}
			<div className="flex items-center gap-4 px-4 py-2 bg-slate-900 border-b border-slate-700 flex-shrink-0">
				<div className="flex items-center gap-2">
					<span className="text-sm font-semibold tracking-tight text-slate-100">cc-inspect</span>
					<span className="text-xs text-slate-500 font-mono">v9</span>
				</div>
				<div className="w-px h-5 bg-slate-700" />
				<SessionPicker sessionData={sessionData} onSelectSession={handleSelectSession} />
				{sessionData && (
					<>
						<div className="w-px h-5 bg-slate-700" />
						<span className="text-xs text-slate-500 font-mono truncate max-w-xs">
							{sessionData.logDirectory}
						</span>
					</>
				)}
				{/* Back to design switcher */}
				<div className="flex-1" />
				<a href="/v1" className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
					designs
				</a>
			</div>

			{sessionData && (
				<FilterBar
					agents={agents}
					search={search}
					onSearchChange={setSearch}
					typeFilter={typeFilter}
					onTypeFilterChange={setTypeFilter}
					agentFilter={agentFilter}
					onAgentFilterChange={setAgentFilter}
					totalCount={sessionData.allEvents.length}
					filteredCount={filteredEvents.length}
				/>
			)}

			{/* Body: list + detail split */}
			<div className="flex-1 flex min-h-0">
				{!sessionData && (
					<div className="flex-1 flex items-center justify-center">
						<div className="text-center">
							<div className="text-slate-600 text-sm mb-2">No session loaded</div>
							<div className="text-slate-700 text-xs">Use the session picker to select a session</div>
						</div>
					</div>
				)}

				{sessionData && (
					<>
						{/* Event list */}
						<div
							ref={listRef}
							role="listbox"
							aria-label="Event list"
							className={`flex-1 overflow-y-auto min-w-0 focus:outline-none ${selectedEvent ? "max-w-[55%]" : ""}`}
							tabIndex={0}
							onKeyDown={handleListKeyDown}
						>
							{filteredEvents.length === 0 && (
								<div className="p-8 text-center text-slate-600 text-sm">No events match filters</div>
							)}
							{filteredEvents.map((event, idx) => (
								<EventRow
									key={event.id}
									event={event}
									agents={agents}
									isSelected={selectedEvent?.id === event.id}
									isFocused={focusedIndex === idx}
									onClick={() => {
										setSelectedEvent(event)
										setFocusedIndex(idx)
									}}
									rowRef={focusedIndex === idx ? focusedRef : undefined}
								/>
							))}
						</div>

						{/* Detail panel */}
						{selectedEvent && (
							<div className="w-[45%] flex-shrink-0 min-h-0">
								<DetailPanel
									event={selectedEvent}
									agents={agents}
									allEvents={sessionData.allEvents}
									onClose={() => setSelectedEvent(null)}
								/>
							</div>
						)}
					</>
				)}
			</div>
		</div>
	)
}
