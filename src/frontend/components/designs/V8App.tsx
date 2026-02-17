import {useCallback, useEffect, useMemo, useRef, useState} from "react"
import type {AgentNode, Event, EventType, SessionData} from "#types"
import {useCliSession, useDirectories, useSessionData, useSessions} from "../../api"

// -- Helpers ------------------------------------------------------------------

function ts(date: Date): string {
	return date.toLocaleTimeString("en-US", {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	})
}

function eventPrefix(event: Event): string {
	const prefixes: Record<EventType, string> = {
		"user-message": "USR",
		"assistant-message": "AST",
		"tool-use": "EXE",
		"tool-result": "RET",
		thinking: "THK",
		"agent-spawn": "SPN",
		summary: "SUM",
	}
	return prefixes[event.type]
}

function eventContent(event: Event): string {
	switch (event.data.type) {
		case "user-message":
			return event.data.text
		case "assistant-message":
			return event.data.text
		case "tool-use":
			return `${event.data.toolName}(${event.data.description ?? "..."})`
		case "tool-result":
			return event.data.output
		case "thinking":
			return event.data.content
		case "agent-spawn":
			return `spawn ${event.data.agentId} -- ${event.data.description}`
		case "summary":
			return event.data.summary
	}
}

function truncLine(text: string, max: number): string {
	const firstLine = text.split("\n")[0] ?? ""
	if (firstLine.length <= max) return firstLine
	return `${firstLine.slice(0, max)}...`
}

function statusChar(event: Event): string {
	if (event.data.type === "tool-result") {
		return event.data.success ? "+" : "!"
	}
	if (event.data.type === "agent-spawn") return "*"
	if (event.data.type === "user-message") return ">"
	if (event.data.type === "assistant-message") return "<"
	if (event.data.type === "thinking") return "~"
	return " "
}

function collectAgents(node: AgentNode): {id: string; name: string}[] {
	const result: {id: string; name: string}[] = [{id: node.id, name: node.name ?? node.id}]
	for (const child of node.children) {
		result.push(...collectAgents(child))
	}
	return result
}

const ALL_TYPES: EventType[] = [
	"user-message",
	"assistant-message",
	"tool-use",
	"tool-result",
	"thinking",
	"agent-spawn",
	"summary",
]

// Phosphor green color constants
const PHOSPHOR = {
	bright: "#33ff33",
	normal: "#22cc22",
	dim: "#118811",
	faint: "#0a550a",
	bg: "#0a0a0a",
	bgLight: "#111111",
	bgHighlight: "#1a2a1a",
	error: "#ff4444",
	warn: "#ccaa22",
}

// -- Sub-components -----------------------------------------------------------

function TermPrompt({text, dimmed}: {text: string; dimmed?: boolean}) {
	return <span style={{color: dimmed ? PHOSPHOR.dim : PHOSPHOR.bright}}>{text}</span>
}

function BootScreen({onOpenPicker}: {onOpenPicker: () => void}) {
	return (
		<div
			className="flex flex-col items-center justify-center min-h-[60vh] font-mono"
			style={{color: PHOSPHOR.normal}}
		>
			<pre className="text-xs mb-6 text-center" style={{color: PHOSPHOR.dim}}>
				{`
   _____ _____ _____ _   _ _____ _____ _____ _____ _____ _____
  |   __|   __|   __| | | |_   _|  ___|  _  |   | |     |  _  |
  |__   |   __|__   | |_| | | | |   __|     | | | |-   -|     |
  |_____|_____|_____|_____| |_| |_____|__|__|_|___|_____|__|__|
`}
			</pre>
			<div className="text-sm mb-4">
				<TermPrompt text="cc-inspect" /> <span style={{color: PHOSPHOR.dim}}>v0.1.0</span>
			</div>
			<div className="text-sm mb-1" style={{color: PHOSPHOR.dim}}>
				Claude Code Session Log Viewer
			</div>
			<div className="text-sm mb-8" style={{color: PHOSPHOR.faint}}>
				Terminal Interface Mode
			</div>
			<button
				type="button"
				onClick={onOpenPicker}
				className="cursor-pointer border px-6 py-2 text-sm font-mono transition-colors"
				style={{
					color: PHOSPHOR.bright,
					borderColor: PHOSPHOR.dim,
					backgroundColor: "transparent",
				}}
				onMouseEnter={(e) => {
					e.currentTarget.style.backgroundColor = PHOSPHOR.faint
					e.currentTarget.style.borderColor = PHOSPHOR.bright
				}}
				onMouseLeave={(e) => {
					e.currentTarget.style.backgroundColor = "transparent"
					e.currentTarget.style.borderColor = PHOSPHOR.dim
				}}
			>
				LOAD SESSION
			</button>
			<div className="mt-4 text-xs" style={{color: PHOSPHOR.faint}}>
				Press [L] to load &bull; [Q] to quit
			</div>
		</div>
	)
}

function TerminalSessionPicker({
	open,
	onClose,
	onSelectSession,
}: {
	open: boolean
	onClose: () => void
	onSelectSession: (path: string) => void
}) {
	const {data: directories = []} = useDirectories()
	const [selectedDir, setSelectedDir] = useState("")
	const {data: sessions = [], isLoading: loadingSessions} = useSessions(selectedDir)
	const [highlightedIdx, setHighlightedIdx] = useState(0)
	const overlayRef = useRef<HTMLDivElement>(null)

	const handleDirChange = (dir: string) => {
		setSelectedDir(dir)
		setHighlightedIdx(0)
	}

	useEffect(() => {
		if (!open) return
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				onClose()
				return
			}
			if (e.key === "ArrowDown") {
				e.preventDefault()
				setHighlightedIdx((i) => Math.min(i + 1, sessions.length - 1))
			}
			if (e.key === "ArrowUp") {
				e.preventDefault()
				setHighlightedIdx((i) => Math.max(i - 1, 0))
			}
			if (e.key === "Enter" && sessions[highlightedIdx]) {
				onSelectSession(sessions[highlightedIdx].sessionFilePath)
				onClose()
			}
		}
		document.addEventListener("keydown", handler)
		return () => document.removeEventListener("keydown", handler)
	}, [open, onClose, sessions, highlightedIdx, onSelectSession])

	if (!open) return null

	return (
		<div
			ref={overlayRef}
			className="fixed inset-0 z-50 flex items-center justify-center"
			style={{backgroundColor: "rgba(0, 0, 0, 0.85)"}}
			onClick={(e) => {
				if (e.target === overlayRef.current) onClose()
			}}
			onKeyDown={() => {}}
			role="dialog"
		>
			<div
				className="border max-w-xl w-full max-h-[70vh] overflow-hidden flex flex-col font-mono"
				style={{
					backgroundColor: PHOSPHOR.bg,
					borderColor: PHOSPHOR.dim,
					boxShadow: `0 0 30px ${PHOSPHOR.faint}`,
				}}
			>
				<div
					className="px-4 py-3 border-b flex items-center justify-between"
					style={{borderColor: PHOSPHOR.faint}}
				>
					<span className="text-sm" style={{color: PHOSPHOR.bright}}>
						SESSION LOADER
					</span>
					<span className="text-xs" style={{color: PHOSPHOR.faint}}>
						[ESC] close
					</span>
				</div>

				<div className="px-4 py-3 border-b" style={{borderColor: PHOSPHOR.faint}}>
					<div className="text-xs mb-2" style={{color: PHOSPHOR.dim}}>
						$ cd &lt;project&gt;
					</div>
					<select
						value={selectedDir}
						onChange={(e) => handleDirChange(e.target.value)}
						className="w-full border px-2 py-1 text-sm font-mono focus:outline-none"
						style={{
							backgroundColor: PHOSPHOR.bgLight,
							color: PHOSPHOR.normal,
							borderColor: PHOSPHOR.dim,
						}}
					>
						<option value="">-- select directory --</option>
						{directories.map((d) => (
							<option key={d} value={d}>
								{d}
							</option>
						))}
					</select>
				</div>

				<div className="flex-1 overflow-y-auto px-4 py-2">
					{loadingSessions && selectedDir && (
						<div className="text-sm py-4" style={{color: PHOSPHOR.dim}}>
							<span className="animate-pulse">scanning...</span>
						</div>
					)}
					{!selectedDir && (
						<div className="text-sm py-4" style={{color: PHOSPHOR.faint}}>
							awaiting directory selection...
						</div>
					)}
					{sessions.map((s, i) => (
						<button
							key={s.id}
							type="button"
							onClick={() => {
								onSelectSession(s.sessionFilePath)
								onClose()
							}}
							className="w-full text-left px-2 py-1 text-sm font-mono transition-colors cursor-pointer block"
							style={{
								color: i === highlightedIdx ? PHOSPHOR.bright : PHOSPHOR.normal,
								backgroundColor: i === highlightedIdx ? PHOSPHOR.bgHighlight : "transparent",
							}}
						>
							{i === highlightedIdx ? "> " : "  "}
							{s.id}
						</button>
					))}
				</div>
			</div>
		</div>
	)
}

function StatusBar({
	data,
	filteredCount,
	totalCount,
	onOpenPicker,
}: {
	data: SessionData
	filteredCount: number
	totalCount: number
	onOpenPicker: () => void
}) {
	const agents = collectAgents(data.mainAgent)

	return (
		<div
			className="flex items-center justify-between px-4 py-1 text-xs font-mono border-b"
			style={{backgroundColor: PHOSPHOR.bgLight, borderColor: PHOSPHOR.faint, color: PHOSPHOR.dim}}
		>
			<div className="flex items-center gap-4">
				<button
					type="button"
					onClick={onOpenPicker}
					className="cursor-pointer hover:underline"
					style={{color: PHOSPHOR.normal}}
				>
					[LOAD]
				</button>
				<span>SID:{data.sessionId.slice(0, 8)}</span>
				<span>AGENTS:{agents.length}</span>
				<span>
					EVENTS:{filteredCount}
					{filteredCount !== totalCount ? `/${totalCount}` : ""}
				</span>
			</div>
			<div style={{color: PHOSPHOR.faint}}>{new Date().toLocaleTimeString("en-US", {hour12: false})}</div>
		</div>
	)
}

function CommandInput({
	searchQuery,
	onSearchChange,
	selectedTypes,
	onToggleType,
	agents,
	selectedAgents,
	onToggleAgent,
	onClearFilters,
}: {
	searchQuery: string
	onSearchChange: (q: string) => void
	selectedTypes: Set<EventType>
	onToggleType: (t: EventType) => void
	agents: {id: string; name: string}[]
	selectedAgents: Set<string>
	onToggleAgent: (id: string) => void
	onClearFilters: () => void
}) {
	const hasFilters = selectedTypes.size > 0 || selectedAgents.size > 0 || searchQuery.length > 0

	return (
		<div className="px-4 py-3 border-b font-mono" style={{borderColor: PHOSPHOR.faint}}>
			{/* Search input */}
			<div className="flex items-center gap-2 mb-2">
				<span style={{color: PHOSPHOR.bright}}>$</span>
				<input
					type="text"
					value={searchQuery}
					onChange={(e) => onSearchChange(e.target.value)}
					placeholder="grep ..."
					className="flex-1 bg-transparent text-sm font-mono focus:outline-none placeholder:opacity-30"
					style={{color: PHOSPHOR.bright, caretColor: PHOSPHOR.bright}}
				/>
				{hasFilters && (
					<button
						type="button"
						onClick={onClearFilters}
						className="text-xs cursor-pointer"
						style={{color: PHOSPHOR.error}}
					>
						[CLEAR]
					</button>
				)}
			</div>

			{/* Type filters */}
			<div className="flex flex-wrap gap-1 mb-2">
				{ALL_TYPES.map((type) => {
					const active = selectedTypes.has(type)
					const prefix = eventPrefix({type, data: {type}} as Event)
					return (
						<button
							key={type}
							type="button"
							onClick={() => onToggleType(type)}
							className="text-xs font-mono px-2 py-0.5 cursor-pointer transition-colors"
							style={{
								color: active ? PHOSPHOR.bg : PHOSPHOR.dim,
								backgroundColor: active ? PHOSPHOR.normal : "transparent",
								border: `1px solid ${active ? PHOSPHOR.normal : PHOSPHOR.faint}`,
							}}
						>
							{prefix}
						</button>
					)
				})}
			</div>

			{/* Agent filters */}
			{agents.length > 1 && (
				<div className="flex flex-wrap gap-1">
					{agents.map((a) => {
						const active = selectedAgents.has(a.id)
						return (
							<button
								key={a.id}
								type="button"
								onClick={() => onToggleAgent(a.id)}
								className="text-xs font-mono px-2 py-0.5 cursor-pointer transition-colors"
								style={{
									color: active ? PHOSPHOR.bg : PHOSPHOR.faint,
									backgroundColor: active ? PHOSPHOR.dim : "transparent",
									border: `1px solid ${active ? PHOSPHOR.dim : PHOSPHOR.faint}`,
								}}
							>
								@{a.name}
							</button>
						)
					})}
				</div>
			)}
		</div>
	)
}

function LogLine({
	event,
	lineNo,
	isSelected,
	onSelect,
}: {
	event: Event
	lineNo: number
	isSelected: boolean
	onSelect: () => void
}) {
	const prefix = eventPrefix(event)
	const status = statusChar(event)
	const content = truncLine(eventContent(event), 120)
	const time = ts(event.timestamp)

	let statusColor = PHOSPHOR.dim
	if (status === "!") statusColor = PHOSPHOR.error
	if (status === "*") statusColor = PHOSPHOR.warn
	if (status === ">") statusColor = PHOSPHOR.bright

	return (
		<button
			type="button"
			onClick={onSelect}
			className="w-full text-left font-mono text-sm py-0.5 px-4 cursor-pointer block transition-colors"
			style={{
				color: isSelected ? PHOSPHOR.bright : PHOSPHOR.normal,
				backgroundColor: isSelected ? PHOSPHOR.bgHighlight : "transparent",
			}}
			onMouseEnter={(e) => {
				if (!isSelected) e.currentTarget.style.backgroundColor = PHOSPHOR.bgLight
			}}
			onMouseLeave={(e) => {
				if (!isSelected) e.currentTarget.style.backgroundColor = "transparent"
			}}
		>
			<span style={{color: PHOSPHOR.faint}}>{String(lineNo).padStart(4, " ")} </span>
			<span style={{color: PHOSPHOR.dim}}>{time} </span>
			<span style={{color: statusColor}}>{status}</span>
			<span style={{color: PHOSPHOR.dim}}>{prefix} </span>
			{event.agentName && (
				<span style={{color: PHOSPHOR.faint}}>@{event.agentName.slice(0, 12).padEnd(12, " ")} </span>
			)}
			<span>{content}</span>
		</button>
	)
}

function DetailPanel({event, onClose}: {event: Event; onClose: () => void}) {
	const content = eventContent(event)
	const prefix = eventPrefix(event)

	return (
		<div
			className="border-l flex flex-col h-full font-mono"
			style={{borderColor: PHOSPHOR.dim, backgroundColor: PHOSPHOR.bg}}
		>
			{/* Header */}
			<div
				className="px-4 py-2 border-b flex items-center justify-between"
				style={{borderColor: PHOSPHOR.faint}}
			>
				<div className="flex items-center gap-3">
					<span className="text-xs" style={{color: PHOSPHOR.bright}}>
						{prefix}
					</span>
					<span className="text-xs" style={{color: PHOSPHOR.dim}}>
						{ts(event.timestamp)}
					</span>
					{event.agentName && (
						<span className="text-xs" style={{color: PHOSPHOR.faint}}>
							@{event.agentName}
						</span>
					)}
				</div>
				<button
					type="button"
					onClick={onClose}
					className="text-xs cursor-pointer"
					style={{color: PHOSPHOR.dim}}
				>
					[X]
				</button>
			</div>

			{/* Metadata */}
			<div className="px-4 py-2 border-b text-xs" style={{borderColor: PHOSPHOR.faint, color: PHOSPHOR.dim}}>
				<div>type: {event.type}</div>
				<div>id: {event.id}</div>
				{event.parentId && <div>parent: {event.parentId}</div>}
				{event.data.type === "tool-use" && <div>tool: {event.data.toolName}</div>}
				{event.data.type === "tool-result" && (
					<div>
						status:{" "}
						<span style={{color: event.data.success ? PHOSPHOR.normal : PHOSPHOR.error}}>
							{event.data.success ? "OK" : "FAIL"}
						</span>
					</div>
				)}
				{event.data.type === "agent-spawn" && (
					<>
						<div>agent: {event.data.agentId}</div>
						{event.data.model && <div>model: {event.data.model}</div>}
					</>
				)}
			</div>

			{/* Content */}
			<div className="flex-1 overflow-y-auto px-4 py-3">
				<pre
					className="text-sm whitespace-pre-wrap break-words leading-relaxed"
					style={{color: PHOSPHOR.normal}}
				>
					{content}
				</pre>
			</div>
		</div>
	)
}

// -- Main V8App ---------------------------------------------------------------

export function V8App() {
	const [selectedSession, setSelectedSession] = useState("")
	const [pickerOpen, setPickerOpen] = useState(false)
	const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
	const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set())
	const [selectedTypes, setSelectedTypes] = useState<Set<EventType>>(new Set())
	const [searchQuery, setSearchQuery] = useState("")

	const {data: sessionData, isLoading: loadingSession} = useSessionData(selectedSession)
	const {data: cliSessionData, isLoading: loadingCli} = useCliSession()

	const data = selectedSession ? (sessionData ?? null) : (cliSessionData ?? null)
	const loading = selectedSession ? loadingSession : loadingCli

	const agents = useMemo(() => (data ? collectAgents(data.mainAgent) : []), [data])

	const filteredEvents = useMemo(() => {
		if (!data) return []
		let events = data.allEvents

		if (selectedAgents.size > 0) {
			events = events.filter((e) => e.agentId && selectedAgents.has(e.agentId))
		}
		if (selectedTypes.size > 0) {
			events = events.filter((e) => selectedTypes.has(e.type))
		}
		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase()
			events = events.filter((e) => eventContent(e).toLowerCase().includes(q))
		}

		return events
	}, [data, selectedAgents, selectedTypes, searchQuery])

	const selectedEvent = useMemo(
		() => filteredEvents.find((e) => e.id === selectedEventId) ?? null,
		[filteredEvents, selectedEventId],
	)

	const toggleAgent = useCallback((id: string) => {
		setSelectedAgents((prev) => {
			const next = new Set(prev)
			if (next.has(id)) next.delete(id)
			else next.add(id)
			return next
		})
	}, [])

	const toggleType = useCallback((type: EventType) => {
		setSelectedTypes((prev) => {
			const next = new Set(prev)
			if (next.has(type)) next.delete(type)
			else next.add(type)
			return next
		})
	}, [])

	const clearFilters = useCallback(() => {
		setSelectedAgents(new Set())
		setSelectedTypes(new Set())
		setSearchQuery("")
	}, [])

	// Keyboard shortcuts
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				if (selectedEventId) {
					setSelectedEventId(null)
				} else if (pickerOpen) {
					setPickerOpen(false)
				}
				return
			}
			// Only handle shortcuts when not in an input
			if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "SELECT")
				return

			if (e.key === "l" || e.key === "L") {
				setPickerOpen(true)
			}
		}
		document.addEventListener("keydown", handler)
		return () => document.removeEventListener("keydown", handler)
	}, [selectedEventId, pickerOpen])

	// Google Fonts for VT323 monospace
	useEffect(() => {
		const id = "v8-vt323-font"
		if (document.getElementById(id)) return
		const link = document.createElement("link")
		link.id = id
		link.rel = "stylesheet"
		link.href = "https://fonts.googleapis.com/css2?family=VT323&display=swap"
		document.head.appendChild(link)
	}, [])

	return (
		<div
			className="min-h-screen flex flex-col"
			style={{
				backgroundColor: PHOSPHOR.bg,
				fontFamily: "'VT323', 'Courier New', monospace",
			}}
		>
			{/* Scanline overlay effect */}
			<div
				className="pointer-events-none fixed inset-0 z-40"
				style={{
					backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.15) 2px, rgba(0,0,0,0.15) 4px)`,
				}}
			/>

			{!data && !loading && <BootScreen onOpenPicker={() => setPickerOpen(true)} />}

			{loading && !data && (
				<div
					className="flex items-center justify-center min-h-[60vh] font-mono text-sm"
					style={{color: PHOSPHOR.dim}}
				>
					<span className="animate-pulse">loading session data...</span>
				</div>
			)}

			{data && (
				<div className="flex flex-col flex-1">
					<StatusBar
						data={data}
						filteredCount={filteredEvents.length}
						totalCount={data.allEvents.length}
						onOpenPicker={() => setPickerOpen(true)}
					/>

					<CommandInput
						searchQuery={searchQuery}
						onSearchChange={setSearchQuery}
						selectedTypes={selectedTypes}
						onToggleType={toggleType}
						agents={agents}
						selectedAgents={selectedAgents}
						onToggleAgent={toggleAgent}
						onClearFilters={clearFilters}
					/>

					<div className="flex flex-1 min-h-0" style={{height: "calc(100vh - 140px)"}}>
						{/* Log lines */}
						<div className="flex-1 overflow-y-auto py-1">
							{filteredEvents.length === 0 && (
								<div className="px-4 py-8 text-center text-sm" style={{color: PHOSPHOR.faint}}>
									no matching events
								</div>
							)}
							{filteredEvents.map((event, i) => (
								<LogLine
									key={event.id}
									event={event}
									lineNo={i + 1}
									isSelected={event.id === selectedEventId}
									onSelect={() => setSelectedEventId(event.id === selectedEventId ? null : event.id)}
								/>
							))}
						</div>

						{/* Detail panel */}
						{selectedEvent && (
							<div className="w-[480px] shrink-0 overflow-hidden">
								<DetailPanel event={selectedEvent} onClose={() => setSelectedEventId(null)} />
							</div>
						)}
					</div>
				</div>
			)}

			<TerminalSessionPicker
				open={pickerOpen}
				onClose={() => setPickerOpen(false)}
				onSelectSession={(path) => setSelectedSession(path)}
			/>
		</div>
	)
}
