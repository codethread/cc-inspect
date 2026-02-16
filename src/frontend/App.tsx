import "./index.css"
import {useEffect} from "react"
import {useCliSession, useSessionData} from "./api"
import {EventDetailsPanel} from "./components/EventDetailsPanel"
import {GraphTimeline} from "./components/GraphTimeline"
import {Header} from "./components/Header"
import {useAppStore} from "./store"

export function App() {
	const selectedSession = useAppStore((s) => s.selectedSession)
	const selectedEvent = useAppStore((s) => s.selectedEvent)
	const selectEvent = useAppStore((s) => s.selectEvent)

	const {
		data: selectedSessionData,
		isLoading: loadingSession,
		error: sessionError,
	} = useSessionData(selectedSession)
	const {data: cliSessionData, isLoading: loadingCli} = useCliSession()

	const sessionData = selectedSession ? (selectedSessionData ?? null) : (cliSessionData ?? null)
	const loading = selectedSession ? loadingSession : loadingCli
	const error = sessionError?.message ?? null

	// Handle keyboard shortcuts
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape" && selectedEvent) {
				selectEvent(null)
			}
		}

		window.addEventListener("keydown", handleKeyDown)
		return () => window.removeEventListener("keydown", handleKeyDown)
	}, [selectedEvent, selectEvent])

	return (
		<div className="min-h-screen bg-gray-950 text-gray-100">
			<Header sessionData={sessionData} />

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

				{sessionData && <GraphTimeline sessionData={sessionData} />}
			</div>

			{/* Side panel for event details */}
			{selectedEvent && sessionData && (
				<EventDetailsPanel agents={[sessionData.mainAgent, ...sessionData.mainAgent.children]} />
			)}
		</div>
	)
}
