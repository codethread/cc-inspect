import "./index.css"
import {useEffect, useMemo, useState} from "react"
import type {Event} from "#types"
import {useCliSession, useDirectories, useSessionData, useSessions} from "./api"
import {DesignSwitcher} from "./components/DesignSwitcher"
import {ColumnsView} from "./components/designs/ColumnsView"
import {ConversationView} from "./components/designs/ConversationView"
import {TraceView} from "./components/designs/TraceView"
import {WaterfallView} from "./components/designs/WaterfallView"
import {Header} from "./components/Header"
import {collectAllAgents, createEmptyFilters, type FilterState, filterEvents} from "./components/shared"

function getUrlParams() {
	const params = new URLSearchParams(window.location.search)
	return {
		directory: params.get("directory") || "",
		sessionPath: params.get("session") || "",
	}
}

function updateUrlParams(directory: string, sessionPath: string) {
	const params = new URLSearchParams()
	if (directory) params.set("directory", directory)
	if (sessionPath) params.set("session", sessionPath)

	const newUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`
	window.history.replaceState({}, "", newUrl)
}

function getCurrentDesign(): string {
	const path = window.location.pathname
	if (path === "/v2") return "v2"
	if (path === "/v3") return "v3"
	if (path === "/v4") return "v4"
	return "v1"
}

export function App() {
	const [selectedDirectory, setSelectedDirectory] = useState(() => getUrlParams().directory)
	const [selectedSession, setSelectedSession] = useState(() => getUrlParams().sessionPath)
	const [selectedEvent, setSelectedEvent] = useState<Event | null>(null)
	const [filters, setFilters] = useState<FilterState>(createEmptyFilters)
	const design = getCurrentDesign()

	const {data: directories = [], error: dirError} = useDirectories()
	const {
		data: sessions = [],
		isLoading: loadingSessions,
		error: sessionsError,
	} = useSessions(selectedDirectory)
	const {
		data: selectedSessionData,
		isLoading: loadingSession,
		error: sessionError,
	} = useSessionData(selectedSession)
	const {data: cliSessionData, isLoading: loadingCli} = useCliSession()

	const sessionData = selectedSession ? (selectedSessionData ?? null) : (cliSessionData ?? null)
	const loading = selectedSession ? loadingSession : loadingCli
	const error = dirError?.message ?? sessionsError?.message ?? sessionError?.message ?? null

	const allAgents = useMemo(() => (sessionData ? collectAllAgents(sessionData.mainAgent) : []), [sessionData])
	const filteredEvents = useMemo(
		() => (sessionData ? filterEvents(sessionData.allEvents, filters) : []),
		[sessionData, filters],
	)

	useEffect(() => {
		if (directories.length > 0 && selectedDirectory && !directories.includes(selectedDirectory)) {
			setSelectedDirectory("")
		}
	}, [directories, selectedDirectory])

	useEffect(() => {
		if (
			sessions.length > 0 &&
			selectedSession &&
			!sessions.find((s) => s.sessionFilePath === selectedSession)
		) {
			setSelectedSession("")
		}
	}, [sessions, selectedSession])

	useEffect(() => {
		updateUrlParams(selectedDirectory, selectedSession)
	}, [selectedDirectory, selectedSession])

	// Redirect bare "/" to "/v1" preserving query params
	useEffect(() => {
		if (window.location.pathname === "/") {
			const params = window.location.search
			window.history.replaceState({}, "", `/v1${params}`)
		}
	}, [])

	const handleDirectoryChange = (dir: string) => {
		setSelectedDirectory(dir)
		setSelectedSession("")
	}

	const handleSessionChange = (sessionPath: string) => {
		setSelectedSession(sessionPath)
	}

	const handleSessionDeleted = () => {
		setSelectedSession("")
	}

	return (
		<div className="min-h-screen bg-gray-950 text-gray-100">
			<Header
				sessionData={sessionData}
				directories={directories}
				selectedDirectory={selectedDirectory}
				onDirectoryChange={handleDirectoryChange}
				loadingDirectories={directories.length === 0 && !dirError}
				sessions={sessions}
				selectedSession={selectedSession}
				onSessionChange={handleSessionChange}
				loadingSessions={loadingSessions}
				onSessionDeleted={handleSessionDeleted}
			/>

			{/* Design switcher bar */}
			<div className="max-w-[1800px] mx-auto px-6 pt-4 flex items-center justify-between">
				<DesignSwitcher />
				<div className="text-xs text-gray-500">
					{design === "v1" && "Waterfall"}
					{design === "v2" && "Conversation"}
					{design === "v3" && "Trace"}
					{design === "v4" && "Columns"}
				</div>
			</div>

			{/* Main content */}
			<div className="max-w-[1800px] mx-auto px-6 py-4">
				{error && (
					<div className="mb-6 p-4 bg-red-900/20 border border-red-900 rounded-lg text-red-400">{error}</div>
				)}

				{loading && selectedSession && !sessionData && (
					<div className="text-center py-12">
						<div className="text-gray-400">Loading session data...</div>
					</div>
				)}

				{!sessionData && !loading && (
					<div className="text-center py-12">
						<div className="text-gray-500">Select a project directory and session to view timeline</div>
					</div>
				)}

				{sessionData && (
					<DesignView
						design={design}
						allAgents={allAgents}
						filteredEvents={filteredEvents}
						filters={filters}
						onFilterChange={setFilters}
						selectedEvent={selectedEvent}
						onSelectEvent={setSelectedEvent}
					/>
				)}
			</div>
		</div>
	)
}

function DesignView({
	design,
	allAgents,
	filteredEvents,
	filters,
	onFilterChange,
	selectedEvent,
	onSelectEvent,
}: {
	design: string
	allAgents: ReturnType<typeof collectAllAgents>
	filteredEvents: Event[]
	filters: FilterState
	onFilterChange: (f: FilterState) => void
	selectedEvent: Event | null
	onSelectEvent: (e: Event | null) => void
}) {
	switch (design) {
		case "v2":
			return (
				<ConversationView
					agents={allAgents}
					events={filteredEvents}
					filters={filters}
					onFilterChange={onFilterChange}
				/>
			)
		case "v3":
			return (
				<TraceView
					agents={allAgents}
					events={filteredEvents}
					filters={filters}
					onFilterChange={onFilterChange}
					selectedEvent={selectedEvent}
					onSelectEvent={onSelectEvent}
				/>
			)
		case "v4":
			return (
				<ColumnsView
					agents={allAgents}
					events={filteredEvents}
					filters={filters}
					onFilterChange={onFilterChange}
					selectedEvent={selectedEvent}
					onSelectEvent={onSelectEvent}
				/>
			)
		default:
			return (
				<WaterfallView
					agents={allAgents}
					events={filteredEvents}
					filters={filters}
					onFilterChange={onFilterChange}
				/>
			)
	}
}
