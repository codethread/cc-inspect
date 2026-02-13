import "./index.css"
import {useEffect, useState} from "react"
import type {Event} from "#types"
import {useCliSession, useDirectories, useSessionData, useSessions} from "./api"
import {EventDetailsPanel} from "./components/EventDetailsPanel"
import {GraphTimeline} from "./components/GraphTimeline"
import {Header} from "./components/Header"

// URL parameter management
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

export function App() {
	const [selectedDirectory, setSelectedDirectory] = useState(() => getUrlParams().directory)
	const [selectedSession, setSelectedSession] = useState(() => getUrlParams().sessionPath)
	const [selectedEvent, setSelectedEvent] = useState<Event | null>(null)

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

	// Clear selectedDirectory if it's not in the loaded list
	useEffect(() => {
		if (directories.length > 0 && selectedDirectory && !directories.includes(selectedDirectory)) {
			setSelectedDirectory("")
		}
	}, [directories, selectedDirectory])

	// Clear selectedSession if it's not in the loaded list
	useEffect(() => {
		if (sessions.length > 0 && selectedSession && !sessions.find((s) => s.path === selectedSession)) {
			setSelectedSession("")
		}
	}, [sessions, selectedSession])

	// Update URL when directory or session changes
	useEffect(() => {
		updateUrlParams(selectedDirectory, selectedSession)
	}, [selectedDirectory, selectedSession])

	// Handle keyboard shortcuts
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape" && selectedEvent) {
				setSelectedEvent(null)
			}
		}

		window.addEventListener("keydown", handleKeyDown)
		return () => window.removeEventListener("keydown", handleKeyDown)
	}, [selectedEvent])

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

			{/* Main content */}
			<div className="max-w-[1800px] mx-auto px-6 py-6">
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
					<GraphTimeline
						sessionData={sessionData}
						onSelectEvent={setSelectedEvent}
						selectedEvent={selectedEvent}
					/>
				)}
			</div>

			{/* Side panel for event details */}
			{selectedEvent && sessionData && (
				<EventDetailsPanel
					event={selectedEvent}
					agents={[sessionData.mainAgent, ...sessionData.mainAgent.children]}
					onClose={() => setSelectedEvent(null)}
				/>
			)}
		</div>
	)
}
