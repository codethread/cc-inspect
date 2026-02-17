import {useCallback, useEffect, useMemo, useRef, useState} from "react"
import type {AgentNode, Event, EventType, SessionData} from "#types"
import {useCliSession, useDirectories, useSessionData, useSessions} from "../../api"

// -- Helpers ------------------------------------------------------------------

function formatTimestamp(date: Date): string {
	return date.toLocaleTimeString("en-US", {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	})
}

function formatDate(date: Date): string {
	return date.toLocaleDateString("en-US", {weekday: "long", year: "numeric", month: "long", day: "numeric"})
}

function truncate(text: string, max: number): string {
	if (text.length <= max) return text
	return `${text.slice(0, max)}...`
}

function eventHeadline(event: Event): string {
	switch (event.data.type) {
		case "user-message":
			return truncate(event.data.text, 120)
		case "assistant-message":
			return truncate(event.data.text, 120)
		case "tool-use":
			return `Tool: ${event.data.toolName}`
		case "tool-result":
			return event.data.success ? "Tool completed successfully" : "Tool failed"
		case "thinking":
			return truncate(event.data.content, 120)
		case "agent-spawn":
			return `Agent spawned: ${event.data.description}`
		case "summary":
			return truncate(event.data.summary, 120)
	}
}

function eventBody(event: Event): string {
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

function sectionLabel(type: EventType): string {
	const labels: Record<EventType, string> = {
		"user-message": "Correspondence",
		"assistant-message": "Editorial",
		"tool-use": "Dispatch",
		"tool-result": "Report",
		thinking: "Analysis",
		"agent-spawn": "Bureau",
		summary: "Digest",
	}
	return labels[type]
}

function sectionColor(type: EventType): string {
	const colors: Record<EventType, string> = {
		"user-message": "text-amber-800",
		"assistant-message": "text-stone-800",
		"tool-use": "text-orange-800",
		"tool-result": "text-emerald-800",
		thinking: "text-rose-900",
		"agent-spawn": "text-indigo-900",
		summary: "text-teal-900",
	}
	return colors[type]
}

function collectAgents(node: AgentNode): {id: string; name: string}[] {
	const result: {id: string; name: string}[] = [{id: node.id, name: node.name ?? node.id}]
	for (const child of node.children) {
		result.push(...collectAgents(child))
	}
	return result
}

const ALL_EVENT_TYPES: EventType[] = [
	"user-message",
	"assistant-message",
	"tool-use",
	"tool-result",
	"thinking",
	"agent-spawn",
	"summary",
]

// -- Sub-components -----------------------------------------------------------

function Masthead({sessionData, onOpenPicker}: {sessionData: SessionData | null; onOpenPicker: () => void}) {
	const today = sessionData?.allEvents[0]?.timestamp ?? new Date()

	return (
		<header className="border-b-4 border-double border-stone-800 pb-4 mb-6">
			<div className="flex items-end justify-between">
				<div className="flex items-center gap-3">
					<button
						type="button"
						onClick={onOpenPicker}
						className="text-stone-500 hover:text-stone-800 transition-colors cursor-pointer"
						title="Select session"
					>
						<svg
							width="20"
							height="20"
							viewBox="0 0 20 20"
							fill="none"
							xmlns="http://www.w3.org/2000/svg"
							role="img"
						>
							<title>Select session</title>
							<path
								d="M2 4h16M2 10h16M2 16h16"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
							/>
						</svg>
					</button>
					<div className="text-xs tracking-[0.4em] uppercase text-stone-500 font-sans">
						{formatDate(today)}
					</div>
				</div>
				<div className="text-xs tracking-[0.3em] uppercase text-stone-400 font-sans">Est. MMXXVI</div>
			</div>

			<h1
				className="text-center mt-3"
				style={{
					fontFamily: "'Playfair Display', 'Georgia', 'Times New Roman', serif",
					fontSize: "3.5rem",
					fontWeight: 900,
					letterSpacing: "-0.02em",
					lineHeight: 1,
				}}
			>
				The Session Chronicle
			</h1>

			<div className="flex items-center justify-center gap-4 mt-2">
				<div className="h-px flex-1 bg-stone-400" />
				<span className="text-xs tracking-[0.3em] uppercase text-stone-500 font-sans">
					{sessionData ? `Session ${sessionData.sessionId.slice(0, 8)}` : "No session loaded"}
				</span>
				<div className="h-px flex-1 bg-stone-400" />
			</div>

			{sessionData && (
				<p className="text-center text-sm text-stone-500 mt-1 italic font-serif">
					{sessionData.allEvents.length} events recorded across {collectAgents(sessionData.mainAgent).length}{" "}
					agent
					{collectAgents(sessionData.mainAgent).length !== 1 ? "s" : ""}
				</p>
			)}
		</header>
	)
}

function SessionPicker({
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
	const overlayRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose()
		}
		if (open) document.addEventListener("keydown", handler)
		return () => document.removeEventListener("keydown", handler)
	}, [open, onClose])

	if (!open) return null

	return (
		<div
			ref={overlayRef}
			className="fixed inset-0 z-50 flex items-center justify-center"
			style={{backgroundColor: "rgba(245, 240, 230, 0.92)", backdropFilter: "blur(4px)"}}
			onClick={(e) => {
				if (e.target === overlayRef.current) onClose()
			}}
			onKeyDown={() => {}}
			role="dialog"
		>
			<div className="bg-amber-50 border-2 border-stone-800 shadow-2xl max-w-lg w-full max-h-[70vh] overflow-hidden flex flex-col">
				<div className="border-b border-stone-300 px-6 py-4 flex items-center justify-between">
					<h2
						className="text-xl text-stone-800"
						style={{fontFamily: "'Playfair Display', Georgia, serif", fontWeight: 700}}
					>
						Select Edition
					</h2>
					<button
						type="button"
						onClick={onClose}
						className="text-stone-400 hover:text-stone-800 text-xl cursor-pointer"
					>
						&times;
					</button>
				</div>

				<div className="px-6 py-4 border-b border-stone-200">
					<label className="block text-xs uppercase tracking-widest text-stone-500 font-sans mb-2">
						Project Directory
						<select
							value={selectedDir}
							onChange={(e) => setSelectedDir(e.target.value)}
							className="mt-2 block w-full border border-stone-300 bg-white text-stone-800 px-3 py-2 text-sm font-sans focus:outline-none focus:border-stone-600"
						>
							<option value="">Choose a directory...</option>
							{directories.map((d) => (
								<option key={d} value={d}>
									{d}
								</option>
							))}
						</select>
					</label>
				</div>

				<div className="flex-1 overflow-y-auto px-6 py-4">
					{loadingSessions && selectedDir && (
						<p className="text-stone-400 italic text-sm font-serif">Searching the archives...</p>
					)}
					{!selectedDir && (
						<p className="text-stone-400 italic text-sm font-serif">Select a directory to browse sessions.</p>
					)}
					{sessions.length > 0 && (
						<ul className="space-y-1">
							{sessions.map((s) => (
								<li key={s.id}>
									<button
										type="button"
										onClick={() => {
											onSelectSession(s.sessionFilePath)
											onClose()
										}}
										className="w-full text-left px-3 py-2 text-sm font-mono text-stone-700 hover:bg-amber-100 border border-transparent hover:border-stone-300 transition-colors cursor-pointer"
									>
										{s.id}
									</button>
								</li>
							))}
						</ul>
					)}
				</div>
			</div>
		</div>
	)
}

function FilterBar({
	agents,
	selectedAgents,
	selectedTypes,
	searchQuery,
	onToggleAgent,
	onToggleType,
	onSearchChange,
	onClearAll,
}: {
	agents: {id: string; name: string}[]
	selectedAgents: Set<string>
	selectedTypes: Set<EventType>
	searchQuery: string
	onToggleAgent: (id: string) => void
	onToggleType: (type: EventType) => void
	onSearchChange: (q: string) => void
	onClearAll: () => void
}) {
	const hasFilters = selectedAgents.size > 0 || selectedTypes.size > 0 || searchQuery.length > 0

	return (
		<div className="border border-stone-300 bg-amber-50/80 mb-6 px-5 py-4">
			<div className="flex items-center gap-4 mb-3">
				<span className="text-xs uppercase tracking-[0.2em] text-stone-500 font-sans font-semibold">
					Classified Index
				</span>
				{hasFilters && (
					<button
						type="button"
						onClick={onClearAll}
						className="text-xs text-rose-700 hover:text-rose-900 underline font-sans cursor-pointer"
					>
						Clear all
					</button>
				)}
			</div>

			{/* Search */}
			<div className="mb-3">
				<input
					type="text"
					value={searchQuery}
					onChange={(e) => onSearchChange(e.target.value)}
					placeholder="Search the record..."
					className="w-full border-b border-stone-300 bg-transparent text-stone-800 px-0 py-1 text-sm font-serif placeholder:text-stone-400 focus:outline-none focus:border-stone-600"
				/>
			</div>

			{/* Event types */}
			<div className="flex flex-wrap gap-2 mb-3">
				{ALL_EVENT_TYPES.map((type) => {
					const active = selectedTypes.has(type)
					return (
						<button
							key={type}
							type="button"
							onClick={() => onToggleType(type)}
							className={`text-xs font-sans px-2 py-0.5 border transition-colors cursor-pointer ${
								active
									? "bg-stone-800 text-amber-50 border-stone-800"
									: "bg-transparent text-stone-600 border-stone-300 hover:border-stone-500"
							}`}
						>
							{sectionLabel(type)}
						</button>
					)
				})}
			</div>

			{/* Agents */}
			{agents.length > 1 && (
				<div className="flex flex-wrap gap-2">
					{agents.map((a) => {
						const active = selectedAgents.has(a.id)
						return (
							<button
								key={a.id}
								type="button"
								onClick={() => onToggleAgent(a.id)}
								className={`text-xs font-mono px-2 py-0.5 border transition-colors cursor-pointer ${
									active
										? "bg-stone-700 text-amber-50 border-stone-700"
										: "bg-transparent text-stone-500 border-stone-300 hover:border-stone-500"
								}`}
							>
								{a.name}
							</button>
						)
					})}
				</div>
			)}
		</div>
	)
}

function ArticleCard({
	event,
	isExpanded,
	onToggle,
}: {
	event: Event
	isExpanded: boolean
	onToggle: () => void
}) {
	const headline = eventHeadline(event)
	const body = eventBody(event)
	const section = sectionLabel(event.type)
	const color = sectionColor(event.type)

	return (
		<button
			type="button"
			className="border-b border-stone-200 pb-4 mb-4 break-inside-avoid cursor-pointer group text-left w-full block"
			onClick={onToggle}
		>
			{/* Section label */}
			<div className={`text-xs uppercase tracking-[0.2em] font-sans font-semibold mb-1 ${color}`}>
				{section}
			</div>

			{/* Byline */}
			<div className="flex items-center gap-2 text-xs text-stone-400 font-sans mb-2">
				<time>{formatTimestamp(event.timestamp)}</time>
				{event.agentName && (
					<>
						<span className="text-stone-300">&bull;</span>
						<span className="italic">{event.agentName}</span>
					</>
				)}
			</div>

			{/* Headline */}
			<h3
				className="text-stone-800 leading-snug mb-2 group-hover:text-stone-600 transition-colors"
				style={{fontFamily: "'Playfair Display', Georgia, serif", fontWeight: 700, fontSize: "1.05rem"}}
			>
				{isExpanded ? headline : truncate(headline, 200)}
			</h3>

			{/* Lede / expanded body */}
			{!isExpanded && (
				<p className="text-sm text-stone-500 font-serif leading-relaxed line-clamp-3">
					{truncate(body, 300)}
				</p>
			)}

			{isExpanded && (
				<div className="mt-2">
					<pre className="text-sm text-stone-700 font-mono whitespace-pre-wrap break-words leading-relaxed bg-amber-50 border border-stone-200 px-4 py-3 max-h-[60vh] overflow-y-auto">
						{body}
					</pre>
				</div>
			)}
		</button>
	)
}

function LeadStory({event, isExpanded, onToggle}: {event: Event; isExpanded: boolean; onToggle: () => void}) {
	const headline = eventHeadline(event)
	const body = eventBody(event)
	const section = sectionLabel(event.type)
	const color = sectionColor(event.type)

	return (
		<button
			type="button"
			className="border-b-2 border-stone-400 pb-6 mb-6 cursor-pointer group col-span-full text-left w-full block"
			onClick={onToggle}
		>
			<div className={`text-xs uppercase tracking-[0.2em] font-sans font-semibold mb-1 ${color}`}>
				{section} &mdash; Lead Story
			</div>
			<div className="flex items-center gap-2 text-xs text-stone-400 font-sans mb-2">
				<time>{formatTimestamp(event.timestamp)}</time>
				{event.agentName && (
					<>
						<span className="text-stone-300">&bull;</span>
						<span className="italic">{event.agentName}</span>
					</>
				)}
			</div>
			<h2
				className="text-stone-900 leading-tight mb-3 group-hover:text-stone-600 transition-colors"
				style={{fontFamily: "'Playfair Display', Georgia, serif", fontWeight: 900, fontSize: "1.8rem"}}
			>
				{headline}
			</h2>
			{!isExpanded && (
				<p className="text-base text-stone-600 font-serif leading-relaxed max-w-prose">
					{truncate(body, 500)}
				</p>
			)}
			{isExpanded && (
				<pre className="text-sm text-stone-700 font-mono whitespace-pre-wrap break-words leading-relaxed bg-amber-50 border border-stone-200 px-4 py-3 max-h-[60vh] overflow-y-auto">
					{body}
				</pre>
			)}
		</button>
	)
}

// -- Main V7App ---------------------------------------------------------------

export function V7App() {
	const [selectedSession, setSelectedSession] = useState("")
	const [pickerOpen, setPickerOpen] = useState(false)
	const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
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
			events = events.filter((e) => {
				const h = eventHeadline(e).toLowerCase()
				const b = eventBody(e).toLowerCase()
				return h.includes(q) || b.includes(q)
			})
		}

		return events
	}, [data, selectedAgents, selectedTypes, searchQuery])

	const toggleExpand = useCallback((id: string) => {
		setExpandedIds((prev) => {
			const next = new Set(prev)
			if (next.has(id)) next.delete(id)
			else next.add(id)
			return next
		})
	}, [])

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

	// Escape to close expanded items
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				if (expandedIds.size > 0) {
					setExpandedIds(new Set())
				}
			}
		}
		document.addEventListener("keydown", handler)
		return () => document.removeEventListener("keydown", handler)
	}, [expandedIds])

	// Google Fonts link injection for Playfair Display
	useEffect(() => {
		const id = "v7-playfair-font"
		if (document.getElementById(id)) return
		const link = document.createElement("link")
		link.id = id
		link.rel = "stylesheet"
		link.href = "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700;900&display=swap"
		document.head.appendChild(link)
	}, [])

	const leadEvent = filteredEvents[0] ?? null
	const restEvents = filteredEvents.slice(1)

	return (
		<div
			className="min-h-screen"
			style={{backgroundColor: "#f5f0e6", color: "#3c3630", fontFamily: "Georgia, 'Times New Roman', serif"}}
		>
			<div className="max-w-6xl mx-auto px-8 py-6">
				<Masthead sessionData={data} onOpenPicker={() => setPickerOpen(true)} />

				{loading && !data && (
					<p className="text-center text-stone-400 italic font-serif py-12">The presses are warming up...</p>
				)}

				{!data && !loading && (
					<div className="text-center py-20">
						<p
							className="text-stone-400 italic mb-2"
							style={{fontFamily: "'Playfair Display', Georgia, serif", fontSize: "1.5rem"}}
						>
							No edition selected
						</p>
						<button
							type="button"
							onClick={() => setPickerOpen(true)}
							className="text-sm font-sans text-stone-600 underline hover:text-stone-800 cursor-pointer"
						>
							Open the archives
						</button>
					</div>
				)}

				{data && (
					<>
						<FilterBar
							agents={agents}
							selectedAgents={selectedAgents}
							selectedTypes={selectedTypes}
							searchQuery={searchQuery}
							onToggleAgent={toggleAgent}
							onToggleType={toggleType}
							onSearchChange={setSearchQuery}
							onClearAll={clearFilters}
						/>

						{filteredEvents.length === 0 && (
							<p className="text-center text-stone-400 italic font-serif py-8">
								No articles match the current filters.
							</p>
						)}

						{leadEvent && (
							<LeadStory
								event={leadEvent}
								isExpanded={expandedIds.has(leadEvent.id)}
								onToggle={() => toggleExpand(leadEvent.id)}
							/>
						)}

						{/* Newspaper columns */}
						<div className="columns-1 md:columns-2 lg:columns-3 gap-8">
							{restEvents.map((event) => (
								<ArticleCard
									key={event.id}
									event={event}
									isExpanded={expandedIds.has(event.id)}
									onToggle={() => toggleExpand(event.id)}
								/>
							))}
						</div>
					</>
				)}

				{/* Footer */}
				<footer className="border-t-2 border-stone-400 mt-12 pt-4 text-center">
					<p className="text-xs text-stone-400 tracking-[0.2em] uppercase font-sans">
						The Session Chronicle &bull; All rights reserved
					</p>
				</footer>
			</div>

			<SessionPicker
				open={pickerOpen}
				onClose={() => setPickerOpen(false)}
				onSelectSession={(path) => setSelectedSession(path)}
			/>
		</div>
	)
}
