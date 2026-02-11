import "./index.css"
import {useEffect, useState} from "react"
import type {
	DirectoriesResponse,
	Event,
	Session,
	SessionData,
	SessionDataResponse,
	SessionsResponse,
} from "#types"
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
	const [sessionData, setSessionData] = useState<SessionData | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [selectedEvent, setSelectedEvent] = useState<Event | null>(null)

	// Selection state
	const [directories, setDirectories] = useState<string[]>([])
	const [selectedDirectory, setSelectedDirectory] = useState<string>("")
	const [sessions, setSessions] = useState<Session[]>([])
	const [selectedSession, setSelectedSession] = useState<string>("")
	const [loadingDirectories, setLoadingDirectories] = useState(false)
	const [loadingSessions, setLoadingSessions] = useState(false)

	// Initialize from URL parameters and load initial data
	useEffect(() => {
		const loadInitialData = async () => {
			const urlParams = getUrlParams()

			// Load directories first
			setLoadingDirectories(true)
			try {
				const dirRes = await fetch("/api/directories")
				const dirData: DirectoriesResponse = await dirRes.json()
				if (dirData.status === "success") {
					setDirectories(dirData.directories)

					// If we have URL params, validate and restore them
					if (urlParams.directory && dirData.directories.includes(urlParams.directory)) {
						setSelectedDirectory(urlParams.directory)
					}
				} else {
					setError(dirData.error)
				}
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err)
				setError(`Failed to load directories: ${message}`)
			} finally {
				setLoadingDirectories(false)
			}

			// Try to load CLI-provided session or URL session
			try {
				const res = await fetch("/api/session")
				const data: SessionDataResponse = await res.json()
				if (data.status === "success") {
					setSessionData(data.data)
					setLoading(false)
					return
				}
			} catch {
				// No CLI session, continue with URL params
			}

			setLoading(false)

			// If we have session path from URL, try to load sessions for that directory
			if (urlParams.sessionPath && urlParams.directory) {
				setSelectedSession(urlParams.sessionPath)
			}
		}

		loadInitialData()
	}, [])

	// Update URL when directory or session changes
	useEffect(() => {
		updateUrlParams(selectedDirectory, selectedSession)
	}, [selectedDirectory, selectedSession])

	// Load sessions when directory is selected
	useEffect(() => {
		if (!selectedDirectory) {
			setSessions([])
			setSelectedSession("")
			return
		}

		const loadSessions = async () => {
			setLoadingSessions(true)
			setSessions([])
			try {
				const res = await fetch(`/api/sessions?directory=${encodeURIComponent(selectedDirectory)}`)
				const data: SessionsResponse = await res.json()
				if (data.status === "success") {
					setSessions(data.sessions)

					// Check if URL session param is valid for this directory
					const urlParams = getUrlParams()
					const validSession = data.sessions.find((s) => s.path === urlParams.sessionPath)
					if (validSession && !selectedSession) {
						setSelectedSession(validSession.path)
					} else if (!validSession && selectedSession) {
						// URL session not valid for this directory, clear it
						setSelectedSession("")
					}
				} else {
					setError(data.error)
				}
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err)
				setError(`Failed to load sessions: ${message}`)
			} finally {
				setLoadingSessions(false)
			}
		}

		loadSessions()
	}, [selectedDirectory, selectedSession])

	// Load session data when session is selected
	useEffect(() => {
		if (!selectedSession) {
			return
		}

		const loadSessionData = async () => {
			setLoading(true)
			setError(null)
			try {
				const res = await fetch(`/api/session?path=${encodeURIComponent(selectedSession)}`)
				const data: SessionDataResponse = await res.json()
				if (data.status === "success") {
					setSessionData(data.data)
				} else {
					setError(data.error)
				}
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err)
				setError(`Failed to load session: ${message}`)
			} finally {
				setLoading(false)
			}
		}

		loadSessionData()
	}, [selectedSession])

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

	// Handle directory change
	const handleDirectoryChange = (dir: string) => {
		setSelectedDirectory(dir)
		setSessionData(null)
	}

	// Handle session change
	const handleSessionChange = (sessionPath: string) => {
		setSelectedSession(sessionPath)
		setSessionData(null)
	}

	// Handle session deletion
	const handleSessionDeleted = async () => {
		// Clear current session
		setSessionData(null)
		setSelectedSession("")

		// Reload sessions list for current directory
		if (selectedDirectory) {
			const res = await fetch(`/api/sessions?directory=${encodeURIComponent(selectedDirectory)}`)
			const data: SessionsResponse = await res.json()
			if (data.status === "success") {
				setSessions(data.sessions)
			}
		}
	}

	return (
		<div className="min-h-screen bg-gray-950 text-gray-100">
			<Header
				sessionData={sessionData}
				directories={directories}
				selectedDirectory={selectedDirectory}
				onDirectoryChange={handleDirectoryChange}
				loadingDirectories={loadingDirectories}
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
