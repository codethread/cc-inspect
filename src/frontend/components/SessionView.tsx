import {useQueryState} from "nuqs"
import {useCallback, useEffect, useMemo, useRef, useState} from "react"
import type {PointerEvent as ReactPointerEvent} from "react"
import {useHotkeys} from "react-hotkeys-hook"
import type {Event} from "#types"
import {SESSION_EVENT_TYPE} from "../../lib/event-catalog"
import {useCliSession, useConfig, useSessionData} from "../api"
import {useFilterStore} from "../stores/filter-store"
import {formatHotkey, SCOPES, useKeybindingsStore} from "../stores/keybindings-store"
import {useSelectionStore} from "../stores/selection-store"
import {useTailStore} from "../stores/tail-store"
import {useUIStore} from "../stores/ui-store"
import {DetailPanel} from "./DetailPanel"
import {FilterDrawer} from "./FilterDrawer"
import {KeyboardShortcutsModal} from "./KeyboardShortcutsModal"
import {Outline} from "./Outline"
import {SearchModal} from "./SearchModal"
import {SessionPicker} from "./SessionPicker"
import {SubagentDrilldown} from "./SubagentDrilldown"
import {SubagentSectionView} from "./SubagentSectionView"
import {matchesFilters} from "./session-view/filtering"
import type {SubagentSection, TurnSection} from "./session-view/types"
import {
	clampPanelSize,
	getPanelBreakpoint,
	loadPanelSizesFromStorage,
	resolvePanelSize,
	savePanelSizesToStorage,
	type PanelBreakpoint,
	type PanelId,
	type PersistedPanelSizes,
	updatePanelSizeForBreakpoint,
} from "./session-view/panel-sizing"
import {groupIntoTurns, groupTurnsIntoSections} from "./session-view/grouping"
import {formatDateTime} from "./session-view/helpers"
import {TurnView} from "./TurnView"
import {TurnWrapper} from "./TurnWrapper"

function collectAgents(node: import("#types").AgentNode): import("#types").AgentNode[] {
	const result: import("#types").AgentNode[] = [node]
	for (const child of node.children) result.push(...collectAgents(child))
	return result
}

// During tailing, inject placeholder SubagentSections for agents that have been spawned
// (AGENT_SPAWN event exists) but don't yet have any events in the timeline. This makes
// in-progress agents visible as collapsed headers before their first event arrives.
function injectPendingAgentSections(
	sections: TurnSection[],
	allEvents: import("#types").Event[],
	agents: import("#types").AgentNode[],
): TurnSection[] {
	const existingAgentIds = new Set<string>()
	for (const s of sections) {
		if (s.kind === "subagent") existingAgentIds.add(s.agentId)
	}

	// Find AGENT_SPAWN events whose spawned agentId has no section yet
	const spawnEvents = allEvents.filter(
		(e) => e.data.type === SESSION_EVENT_TYPE.AGENT_SPAWN && !existingAgentIds.has(e.data.agentId),
	)
	if (spawnEvents.length === 0) return sections

	const result: TurnSection[] = []
	const injected = new Set<string>()

	for (const section of sections) {
		result.push(section)
		if (section.kind !== "main") continue

		// Check if this turn contains an AGENT_SPAWN for a pending agent
		for (const event of section.turn.events) {
			if (
				event.data.type === SESSION_EVENT_TYPE.AGENT_SPAWN &&
				!existingAgentIds.has(event.data.agentId) &&
				!injected.has(event.data.agentId)
			) {
				const agentId = event.data.agentId
				const agent = agents.find((a) => a.id === agentId) ?? null
				const placeholder: SubagentSection = {
					kind: "subagent",
					agentId,
					agent,
					turns: [],
				}
				result.push(placeholder)
				injected.add(agentId)
			}
		}
	}

	return result
}

interface PanelResizeState {
	panel: PanelId
	breakpoint: PanelBreakpoint
	startX: number
	startWidth: number
	previewWidth: number
	hasMoved: boolean
}

export function SessionView() {
	const [sessionPath, setSessionPath] = useQueryState("session", {defaultValue: ""})

	const {
		filterOpen,
		searchOpen,
		shortcutsOpen,
		showOutline,
		allToolsExpanded,
		drilldownAgentId,
		setFilterOpen,
		setSearchOpen,
		setShortcutsOpen,
		setShowOutline,
		setAllToolsExpanded,
		setDrilldownAgentId,
	} = useUIStore()

	const {search, typeInclude, typeExclude, agentFilter, errorsOnly, clearFilters} = useFilterStore()
	const setErrorsOnly = useFilterStore((s) => s.setErrorsOnly)

	const {selectedEvent, activeTurnId, setSelectedEvent, setActiveTurnId} = useSelectionStore()

	const getKeys = useKeybindingsStore((s) => s.getKeys)

	const {data: sessionDataFromPath} = useSessionData(sessionPath)
	const {data: cliSession} = useCliSession()
	const {data: config} = useConfig()

	const {
		connection,
		sessionData: tailData,
		isIdle,
		autoScroll,
		newEventCount,
		startTailing,
		stopTailing,
		setAutoScroll,
		resetNewEventCount,
	} = useTailStore()

	const isTailing = connection.status !== "disconnected"

	const fetchedSessionData = sessionPath ? (sessionDataFromPath ?? null) : (cliSession ?? null)
	const sessionData = isTailing ? (tailData ?? fetchedSessionData) : fetchedSessionData

	const resolvedSessionFilePath =
		sessionPath || (sessionData ? `${sessionData.logDirectory}/${sessionData.sessionId}.jsonl` : null)

	// Auto-start tailing when CLI config requests it
	const autoStartedRef = useRef(false)
	useEffect(() => {
		if (autoStartedRef.current) return
		if (!config?.tailEnabled || !config.sessionPath) return
		autoStartedRef.current = true
		setSessionPath(config.sessionPath)
		startTailing(config.sessionPath)
	}, [config, setSessionPath, startTailing])

	// Track event count at the moment the first snapshot arrives (new-event baseline)
	const initialEventCountRef = useRef<number | null>(null)
	useEffect(() => {
		if (connection.status === "disconnected") {
			initialEventCountRef.current = null
			return
		}
		// Set baseline once, on the first snapshot after connect (tailData goes null → populated)
		if (connection.status === "connected" && tailData && initialEventCountRef.current === null) {
			initialEventCountRef.current = tailData.allEvents.length
		}
	}, [connection.status, tailData])

	// Sentinel ref for auto-scroll
	const sentinelRef = useRef<HTMLDivElement | null>(null)

	// Auto-scroll when new events arrive and autoScroll is enabled — only during active tailing
	const allEventsLength = sessionData?.allEvents.length ?? 0
	useEffect(() => {
		if (!isTailing || !autoScroll || !sentinelRef.current) return
		// allEventsLength in deps triggers this when new events arrive
		void allEventsLength
		sentinelRef.current.scrollIntoView({behavior: "smooth"})
	}, [isTailing, autoScroll, allEventsLength])

	// Track scroll position to determine autoScroll intent — only the user
	// physically scrolling to the bottom should re-enable autoScroll, not DOM
	// growth from new events repositioning the sentinel into view.
	useEffect(() => {
		const el = timelineRef.current
		if (!el || !isTailing) return

		const handleScroll = () => {
			const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50
			setAutoScroll(isAtBottom)
		}

		el.addEventListener("scroll", handleScroll, {passive: true})
		return () => el.removeEventListener("scroll", handleScroll)
	}, [isTailing, setAutoScroll])

	// Helper to check if an event is "new" (arrived after initial snapshot)
	const isNewEvent = useCallback(
		(eventId: string): boolean => {
			if (!isTailing || initialEventCountRef.current === null || !tailData) return false
			const idx = tailData.allEvents.findIndex((e) => e.id === eventId)
			return idx >= initialEventCountRef.current
		},
		[isTailing, tailData],
	)

	const agents = useMemo(() => (sessionData ? collectAgents(sessionData.mainAgent) : []), [sessionData])
	const mainAgentId = sessionData?.mainAgent.id ?? ""

	const {errorCount, failedToolUseIds} = useMemo(() => {
		if (!sessionData) return {errorCount: 0, failedToolUseIds: new Set<string>()}
		let count = 0
		const ids = new Set<string>()
		for (const e of sessionData.allEvents) {
			if (e.data.type === SESSION_EVENT_TYPE.TOOL_RESULT && !e.data.success) {
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
	const activePanelResizeRef = useRef<PanelResizeState | null>(null)
	const outlinePanelRef = useRef<HTMLElement | null>(null)
	const detailPanelRef = useRef<HTMLElement | null>(null)
	const panelWidthRafRef = useRef<number | null>(null)
	const pendingPanelWidthRef = useRef<{panel: PanelId; width: number} | null>(null)

	const [viewportWidth, setViewportWidth] = useState(typeof window === "undefined" ? 1600 : window.innerWidth)
	const [isPanelResizing, setIsPanelResizing] = useState(false)
	const [savedPanelSizes, setSavedPanelSizes] = useState<PersistedPanelSizes>(() =>
		loadPanelSizesFromStorage(typeof window === "undefined" ? null : window.localStorage),
	)

	const activePanelBreakpoint = useMemo(() => getPanelBreakpoint(viewportWidth), [viewportWidth])

	const outlinePanelWidth = useMemo(
		() =>
			resolvePanelSize({
				panel: "outline",
				breakpoint: activePanelBreakpoint,
				sizes: savedPanelSizes,
			}),
		[activePanelBreakpoint, savedPanelSizes],
	)

	const detailPanelWidth = useMemo(
		() =>
			resolvePanelSize({
				panel: "detail",
				breakpoint: activePanelBreakpoint,
				sizes: savedPanelSizes,
			}),
		[activePanelBreakpoint, savedPanelSizes],
	)

	useEffect(() => {
		if (typeof window === "undefined") return
		const handleResize = () => setViewportWidth(window.innerWidth)
		handleResize()
		window.addEventListener("resize", handleResize)
		return () => window.removeEventListener("resize", handleResize)
	}, [])

	useEffect(() => {
		if (typeof window === "undefined") return
		savePanelSizesToStorage({storage: window.localStorage, sizes: savedPanelSizes})
	}, [savedPanelSizes])

	const schedulePanelWidthPreview = useCallback((panel: PanelId, width: number) => {
		pendingPanelWidthRef.current = {panel, width}
		if (panelWidthRafRef.current !== null) return

		panelWidthRafRef.current = window.requestAnimationFrame(() => {
			panelWidthRafRef.current = null
			const pendingWidth = pendingPanelWidthRef.current
			if (!pendingWidth) return
			const panelElement = pendingWidth.panel === "outline" ? outlinePanelRef.current : detailPanelRef.current
			if (!panelElement) return
			panelElement.style.width = `${pendingWidth.width}px`
		})
	}, [])

	useEffect(() => {
		return () => {
			if (panelWidthRafRef.current !== null) {
				window.cancelAnimationFrame(panelWidthRafRef.current)
			}
		}
	}, [])

	const handlePanelResizeStart = useCallback(
		(panel: PanelId, event: ReactPointerEvent<HTMLElement>) => {
			event.preventDefault()
			const startWidth = panel === "outline" ? outlinePanelWidth : detailPanelWidth
			activePanelResizeRef.current = {
				panel,
				breakpoint: activePanelBreakpoint,
				startX: event.clientX,
				startWidth,
				previewWidth: startWidth,
				hasMoved: false,
			}
			schedulePanelWidthPreview(panel, startWidth)
			setIsPanelResizing(true)
		},
		[activePanelBreakpoint, detailPanelWidth, outlinePanelWidth, schedulePanelWidthPreview],
	)

	useEffect(() => {
		if (!isPanelResizing) return

		const handlePointerMove = (event: PointerEvent) => {
			const activeResize = activePanelResizeRef.current
			if (!activeResize) return

			const deltaX = event.clientX - activeResize.startX
			const nextSize =
				activeResize.panel === "outline" ? activeResize.startWidth + deltaX : activeResize.startWidth - deltaX
			const clampedSize = clampPanelSize(activeResize.panel, activeResize.breakpoint, nextSize)
			if (clampedSize === activeResize.previewWidth) return

			activeResize.previewWidth = clampedSize
			activeResize.hasMoved ||= clampedSize !== activeResize.startWidth
			schedulePanelWidthPreview(activeResize.panel, clampedSize)
		}

		const stopResizing = () => {
			const activeResize = activePanelResizeRef.current
			if (!activeResize) return
			if (activeResize.hasMoved) {
				setSavedPanelSizes((current) =>
					updatePanelSizeForBreakpoint({
						breakpoint: activeResize.breakpoint,
						panel: activeResize.panel,
						size: activeResize.previewWidth,
						sizes: current,
					}),
				)
			}
			activePanelResizeRef.current = null
			setIsPanelResizing(false)
		}

		window.addEventListener("pointermove", handlePointerMove)
		window.addEventListener("pointerup", stopResizing)
		window.addEventListener("pointercancel", stopResizing)

		return () => {
			window.removeEventListener("pointermove", handlePointerMove)
			window.removeEventListener("pointerup", stopResizing)
			window.removeEventListener("pointercancel", stopResizing)
		}
	}, [isPanelResizing, schedulePanelWidthPreview])

	useEffect(() => {
		if (outlinePanelRef.current) {
			outlinePanelRef.current.style.width = `${outlinePanelWidth}px`
		}
	}, [outlinePanelWidth])

	useEffect(() => {
		if (detailPanelRef.current) {
			detailPanelRef.current.style.width = `${detailPanelWidth}px`
		}
	}, [detailPanelWidth])

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
			stopTailing()
			setSessionPath(path)
			setActiveTurnId(null)
			setSelectedEvent(null)
			setDrilldownAgentId(null)
			pinnedEventIdRef.current = null
		},
		[stopTailing, setSessionPath, setActiveTurnId, setSelectedEvent, setDrilldownAgentId],
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
		<div
			className={`h-screen flex flex-col bg-zinc-950 text-zinc-200 ${isPanelResizing ? "select-none" : ""}`}
		>
			{/* Header */}
			<header className="flex items-center gap-4 px-6 py-3 bg-zinc-900/80 border-b border-zinc-800 flex-shrink-0 backdrop-blur-sm">
				<span className="text-sm font-semibold text-zinc-100 tracking-tight">cc-inspect</span>
				<SessionPicker sessionData={sessionData} onSelect={handleSelectSession} />

				{/* Tail toggle button */}
				{(sessionData || isTailing) && (
					<button
						type="button"
						onClick={() => {
							if (isTailing) {
								stopTailing()
							} else if (resolvedSessionFilePath) {
								startTailing(resolvedSessionFilePath)
							}
						}}
						className="p-1.5 rounded-lg transition-colors cursor-pointer text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800"
						title={isTailing ? "Stop live tailing" : "Start live tailing"}
					>
						{isTailing ? (
							<svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
								<rect x="5" y="5" width="14" height="14" rx="2" />
							</svg>
						) : (
							<svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
								<path d="M8 5v14l11-7z" />
							</svg>
						)}
					</button>
				)}

				{/* LIVE badge */}
				{isTailing && (
					<span
						className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${
							isIdle
								? "bg-zinc-500/15 text-zinc-400 border-zinc-500/30"
								: connection.status === "reconnecting"
									? "bg-amber-500/15 text-amber-400 border-amber-500/30"
									: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
						}`}
					>
						<span
							className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
								isIdle
									? "bg-zinc-400"
									: connection.status === "reconnecting"
										? "bg-amber-400"
										: "bg-emerald-500 animate-pulse"
							}`}
						/>
						{isIdle ? "IDLE" : connection.status === "reconnecting" ? "RECONNECTING" : "LIVE"}
					</span>
				)}

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
				{sessionData && showOutline && !drilldownAgentId && (
					<>
						<aside
							ref={outlinePanelRef}
							style={{width: outlinePanelWidth}}
							className="flex-shrink-0 overflow-y-auto border-r border-zinc-800/50 bg-zinc-950"
						>
							<Outline
								turns={turns}
								agents={agents}
								mainAgentId={mainAgentId}
								activeTurnId={activeTurnId}
								onNavigate={handleNavigate}
							/>
						</aside>
						<button
							type="button"
							aria-label="Resize outline panel"
							onPointerDown={(event) => handlePanelResizeStart("outline", event)}
							className="-ml-px w-3 flex-shrink-0 cursor-col-resize bg-transparent hover:bg-zinc-900/35 active:bg-zinc-800/45 transition-colors border-0 p-0 focus-visible:outline-none focus-visible:bg-zinc-800/50"
						/>
					</>
				)}

				{/* Timeline (center) */}
				<main ref={timelineRef} className="relative flex-1 overflow-y-auto min-w-0">
					{!sessionData && (
						<div className="flex items-center justify-center h-full">
							<div className="text-center">
								<div className="text-zinc-600 text-sm mb-1">No session loaded</div>
								<div className="text-zinc-700 text-xs">Open a session to begin reading</div>
							</div>
						</div>
					)}

					{sessionData && turns.length === 0 && !drilldownAgentId && (
						<div className="flex items-center justify-center h-full">
							<div className="text-zinc-600 text-sm">No events match current filters</div>
						</div>
					)}

					{/* Drilldown view: replaces normal timeline when drilling into a subagent */}
					{sessionData && drilldownAgentId && (
						<>
							<SubagentDrilldown
								agentId={drilldownAgentId}
								sessionData={sessionData}
								agents={agents}
								selectedEventId={selectedEvent?.id ?? null}
								onSelectEvent={handleSelectEvent}
								onTurnVisible={setActiveTurnId}
								defaultToolsExpanded={allToolsExpanded}
								isNewEvent={isNewEvent}
							/>
							<div ref={sentinelRef} />
						</>
					)}

					{sessionData && turns.length > 0 && !drilldownAgentId && (
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
							{(() => {
								const baseSections = groupTurnsIntoSections(turns, mainAgentId, agents)
								return isTailing
									? injectPendingAgentSections(baseSections, sessionData.allEvents, agents)
									: baseSections
							})().map((section) => {
								if (section.kind === "main") {
									const turn = section.turn
									const isNew = turn.events.some((e) => isNewEvent(e.id))
									return (
										<div key={turn.id} className={isNew ? "tail-new-event" : undefined}>
											<TurnWrapper turnId={turn.id} onVisible={setActiveTurnId}>
												<TurnView
													turn={turn}
													agents={agents}
													allEvents={sessionData.allEvents}
													selectedEventId={selectedEvent?.id ?? null}
													onSelectEvent={handleSelectEvent}
													defaultToolsExpanded={allToolsExpanded}
												/>
											</TurnWrapper>
										</div>
									)
								}
								const sectionKey = `${section.agentId}-${section.turns[0]?.id}`
								const isNew = section.turns.some((t) => t.events.some((e) => isNewEvent(e.id)))
								return (
									<div key={sectionKey} className={isNew ? "tail-new-event" : undefined}>
										<SubagentSectionView
											section={section}
											agents={agents}
											allEvents={sessionData.allEvents}
											selectedEventId={selectedEvent?.id ?? null}
											onSelectEvent={handleSelectEvent}
											onTurnVisible={setActiveTurnId}
											defaultToolsExpanded={allToolsExpanded}
											isTailing={isTailing}
											onDrilldown={setDrilldownAgentId}
										/>
									</div>
								)
							})}

							<div className="h-32" />
							<div ref={sentinelRef} />
						</div>
					)}
					{/* Floating scroll-to-bottom button — appears when tailing and user has scrolled up */}
					{isTailing && !autoScroll && newEventCount > 0 && (
						<button
							type="button"
							onClick={() => {
								sentinelRef.current?.scrollIntoView({behavior: "smooth"})
								setAutoScroll(true)
								resetNewEventCount()
							}}
							className="absolute bottom-6 right-6 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-600 text-white text-sm font-medium shadow-lg cursor-pointer hover:bg-emerald-500 transition-colors"
						>
							<svg
								className="w-4 h-4"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								aria-hidden="true"
							>
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
							</svg>
							{newEventCount}
						</button>
					)}
				</main>

				{/* Detail panel (always visible) */}
				{sessionData && (
					<>
						<button
							type="button"
							aria-label="Resize detail panel"
							onPointerDown={(event) => handlePanelResizeStart("detail", event)}
							className="-mr-px w-3 flex-shrink-0 cursor-col-resize bg-transparent hover:bg-zinc-900/35 active:bg-zinc-800/45 transition-colors border-0 p-0 focus-visible:outline-none focus-visible:bg-zinc-800/50"
						/>
						<aside ref={detailPanelRef} style={{width: detailPanelWidth}} className="flex-shrink-0 min-h-0">
							<DetailPanel
								event={selectedEvent}
								allEvents={sessionData.allEvents}
								agents={agents}
								sessionFilePath={resolvedSessionFilePath}
							/>
						</aside>
					</>
				)}
			</div>

			{/* Filter drawer */}
			{!drilldownAgentId && (
				<FilterDrawer
					open={filterOpen}
					onClose={() => setFilterOpen(false)}
					agents={agents}
					errorCount={errorCount}
				/>
			)}

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
