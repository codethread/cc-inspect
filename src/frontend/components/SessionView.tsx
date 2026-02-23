import {useQueryState} from "nuqs"
import {useCallback, useEffect, useMemo, useRef} from "react"
import {useHotkeys} from "react-hotkeys-hook"
import type {Event} from "#types"
import {useCliSession, useSessionData} from "../api"
import {useFilterStore} from "../stores/filter-store"
import {formatHotkey, SCOPES, useKeybindingsStore} from "../stores/keybindings-store"
import {useSelectionStore} from "../stores/selection-store"
import {useUIStore} from "../stores/ui-store"
import {DetailPanel} from "./DetailPanel"
import {FilterDrawer} from "./FilterDrawer"
import {KeyboardShortcutsModal} from "./KeyboardShortcutsModal"
import {Outline} from "./Outline"
import {SearchModal} from "./SearchModal"
import {SessionPicker} from "./SessionPicker"
import {SubagentSectionView} from "./SubagentSectionView"
import {matchesFilters} from "./session-view/filtering"
import {groupIntoTurns, groupTurnsIntoSections} from "./session-view/grouping"
import {formatDateTime} from "./session-view/helpers"
import {TurnView} from "./TurnView"
import {TurnWrapper} from "./TurnWrapper"

function collectAgents(node: import("#types").AgentNode): import("#types").AgentNode[] {
	const result: import("#types").AgentNode[] = [node]
	for (const child of node.children) result.push(...collectAgents(child))
	return result
}

export function SessionView() {
	const [sessionPath, setSessionPath] = useQueryState("session", {defaultValue: ""})

	const {
		filterOpen,
		searchOpen,
		shortcutsOpen,
		showOutline,
		allToolsExpanded,
		setFilterOpen,
		setSearchOpen,
		setShortcutsOpen,
		setShowOutline,
		setAllToolsExpanded,
	} = useUIStore()

	const {search, typeInclude, typeExclude, agentFilter, errorsOnly, clearFilters} = useFilterStore()
	const setErrorsOnly = useFilterStore((s) => s.setErrorsOnly)

	const {selectedEvent, activeTurnId, setSelectedEvent, setActiveTurnId} = useSelectionStore()

	const getKeys = useKeybindingsStore((s) => s.getKeys)

	const {data: sessionDataFromPath} = useSessionData(sessionPath)
	const {data: cliSession} = useCliSession()
	const sessionData = sessionPath ? (sessionDataFromPath ?? null) : (cliSession ?? null)
	const resolvedSessionFilePath = sessionPath || (sessionData ? `${sessionData.logDirectory}/${sessionData.sessionId}.jsonl` : null)

	const agents = useMemo(() => (sessionData ? collectAgents(sessionData.mainAgent) : []), [sessionData])
	const mainAgentId = sessionData?.mainAgent.id ?? ""

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
							typeInclude,
							typeExclude,
							agentFilter,
							errorsOnly,
							failedToolUseIds,
						}),
					)
				: [],
		[sessionData, search, typeInclude, typeExclude, agentFilter, errorsOnly, failedToolUseIds],
	)

	const turns = useMemo(() => groupIntoTurns(filteredEvents, mainAgentId), [filteredEvents, mainAgentId])

	const timelineRef = useRef<HTMLElement | null>(null)

	const pinnedEventIdRef = useRef<string | null>(null)
	const prevFilterKeyRef = useRef("")
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
				timelineRef.current
					?.querySelector(`[data-turn-id="${turn.id}"]`)
					?.scrollIntoView({behavior: "smooth", block: "start"})
				pendingScrollToRef.current = null
				break
			}
		}
	}, [turns])

	const filterKey = `${search}|${[...typeInclude].join(",")}|${[...typeExclude].join(",")}|${[...agentFilter].join(",")}|${errorsOnly}`
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

	// -------------------------------------------------------------------------
	// Keyboard shortcuts (global scope — disabled when a modal overlay is open)
	// -------------------------------------------------------------------------

	useHotkeys(
		getKeys("search.open"),
		() => {
			setFilterOpen(false)
			setSearchOpen(true)
		},
		{enabled: !!sessionData, scopes: [SCOPES.GLOBAL], preventDefault: true},
	)

	useHotkeys(
		getKeys("outline.toggle"),
		() => setShowOutline(!showOutline),
		{enabled: !!sessionData, scopes: [SCOPES.GLOBAL], preventDefault: true},
		[showOutline],
	)

	useHotkeys(
		getKeys("filter.open"),
		() => {
			setSearchOpen(false)
			setFilterOpen(true)
		},
		{enabled: !!sessionData, scopes: [SCOPES.GLOBAL], preventDefault: true},
	)

	useHotkeys(
		getKeys("tools.toggle"),
		() => setAllToolsExpanded(!allToolsExpanded),
		{enabled: !!sessionData, scopes: [SCOPES.GLOBAL], preventDefault: true},
		[allToolsExpanded],
	)

	// Escape: dismiss in priority order — search modal → filter drawer → selection
	// Not in scopes (uses enabled instead) so it works regardless of active scope
	useHotkeys(
		"escape",
		(e) => {
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
		},
		{enabled: searchOpen || filterOpen || !!selectedEvent, enableOnFormTags: true},
		[searchOpen, filterOpen, selectedEvent],
	)

	const handleNavigate = useCallback(
		(turnId: string) => {
			timelineRef.current
				?.querySelector(`[data-turn-id="${turnId}"]`)
				?.scrollIntoView({behavior: "smooth", block: "start"})
			setActiveTurnId(turnId)
		},
		[setActiveTurnId],
	)

	const handleSelectSession = useCallback(
		(path: string) => {
			setSessionPath(path)
			setActiveTurnId(null)
			setSelectedEvent(null)
			pinnedEventIdRef.current = null
		},
		[setSessionPath, setActiveTurnId, setSelectedEvent],
	)

	const handleSelectEvent = useCallback(
		(event: Event) => {
			setSelectedEvent(event)
			pinnedEventIdRef.current = event.id
		},
		[setSelectedEvent],
	)

	// Select from search modal: clear filters so the event is guaranteed visible,
	// then use pendingScrollToRef so the post-turns-render effect can scroll —
	// falling back to turn-level scroll for events not in the DOM (collapsed
	// accordions, tool-results excluded from rendering).
	const handleSearchSelect = useCallback(
		(event: Event) => {
			clearFilters()
			setSelectedEvent(event)
			pinnedEventIdRef.current = event.id
			pendingScrollToRef.current = event.id
		},
		[clearFilters, setSelectedEvent],
	)

	const isFiltered =
		search || typeInclude.size > 0 || typeExclude.size > 0 || agentFilter.size > 0 || errorsOnly

	return (
		<div className="h-screen flex flex-col bg-zinc-950 text-zinc-200">
			{/* Header */}
			<header className="flex items-center gap-4 px-6 py-3 bg-zinc-900/80 border-b border-zinc-800 flex-shrink-0 backdrop-blur-sm">
				<span className="text-sm font-semibold text-zinc-100 tracking-tight">cc-inspect</span>
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
							title={`Search events (${formatHotkey(getKeys("search.open"))})`}
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
							<kbd className="font-mono">{formatHotkey(getKeys("search.open"))}</kbd>
						</button>
						<button
							type="button"
							onClick={() => setAllToolsExpanded(!allToolsExpanded)}
							className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
								allToolsExpanded ? "text-zinc-600 hover:text-zinc-400" : "bg-zinc-800 text-zinc-300"
							}`}
							title={`${allToolsExpanded ? "Collapse" : "Expand"} all tool calls (${formatHotkey(getKeys("tools.toggle"))})`}
						>
							<svg
								className="w-4 h-4"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
								aria-hidden="true"
							>
								{allToolsExpanded ? (
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 9l-7 7-7-7" />
								) : (
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
								)}
							</svg>
						</button>
						<button
							type="button"
							onClick={() => setShowOutline(!showOutline)}
							className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
								showOutline ? "bg-zinc-800 text-zinc-300" : "text-zinc-600 hover:text-zinc-400"
							}`}
							title={`Toggle outline (${formatHotkey(getKeys("outline.toggle"))})`}
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
							title={`Filters (${formatHotkey(getKeys("filter.open"))})`}
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

				{/* Keyboard shortcuts config — always visible */}
				<button
					type="button"
					onClick={() => setShortcutsOpen(true)}
					className="p-1.5 rounded-lg text-zinc-600 hover:text-zinc-400 transition-colors cursor-pointer"
					title="Keyboard shortcuts"
				>
					<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth={1.5}
							d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
						/>
					</svg>
				</button>
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
										<TurnWrapper key={turn.id} turnId={turn.id} onVisible={setActiveTurnId}>
											<TurnView
												turn={turn}
												agents={agents}
												allEvents={sessionData.allEvents}
												selectedEventId={selectedEvent?.id ?? null}
												onSelectEvent={handleSelectEvent}
												defaultToolsExpanded={allToolsExpanded}
											/>
										</TurnWrapper>
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
										onTurnVisible={setActiveTurnId}
										defaultToolsExpanded={allToolsExpanded}
									/>
								)
							})}

							<div className="h-32" />
						</div>
					)}
				</main>

				{/* Detail panel (always visible) */}
				{sessionData && (
					<aside className="w-[450px] flex-shrink-0 min-h-0">
						<DetailPanel
							event={selectedEvent}
							allEvents={sessionData.allEvents}
							agents={agents}
							sessionFilePath={resolvedSessionFilePath}
						/>
					</aside>
				)}
			</div>

			{/* Filter drawer */}
			<FilterDrawer
				open={filterOpen}
				onClose={() => setFilterOpen(false)}
				agents={agents}
				errorCount={errorCount}
			/>

			{/* Search modal (configurable shortcut) */}
			{searchOpen && sessionData && (
				<SearchModal
					events={sessionData.allEvents}
					agents={agents}
					sessionFilePath={resolvedSessionFilePath}
					onGoToTimeline={handleSearchSelect}
					onClose={() => setSearchOpen(false)}
				/>
			)}

			{/* Keyboard shortcuts config modal */}
			{shortcutsOpen && <KeyboardShortcutsModal onClose={() => setShortcutsOpen(false)} />}
		</div>
	)
}
