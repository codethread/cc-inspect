import {createFileRoute} from "@tanstack/react-router"
import {z} from "zod"
import {useEffect} from "react"
import {useCliSession, useSessionData} from "../api"
import {EventDetailsPanel} from "../components/EventDetailsPanel"
import {GraphTimeline} from "../components/GraphTimeline"
import {Header} from "../components/Header"
import {useAppStore} from "../store"

const searchSchema = z.object({
	directory: z.optional(z.string()).catch(undefined),
	session: z.optional(z.string()).catch(undefined),
})

export const Route = createFileRoute("/")({
	validateSearch: (search) => searchSchema.parse(search),
	component: IndexRoute,
})

function IndexRoute() {
	const {session} = Route.useSearch()
	const selectedEvent = useAppStore((s) => s.selectedEvent)
	const selectEvent = useAppStore((s) => s.selectEvent)

	const {
		data: selectedSessionData,
		isLoading: loadingSession,
		error: sessionError,
	} = useSessionData(session ?? "")
	const {data: cliSessionData, isLoading: loadingCli} = useCliSession()

	const sessionData = session ? (selectedSessionData ?? null) : (cliSessionData ?? null)
	const loading = session ? loadingSession : loadingCli
	const error = sessionError?.message ?? null

	// biome-ignore lint/correctness/useExhaustiveDependencies: session is intentional trigger; not read inside effect
	useEffect(() => {
		selectEvent(null)
	}, [session, selectEvent])

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
		<>
			<Header sessionData={sessionData} />

			<div className="max-w-[1800px] mx-auto px-6 py-6">
				{error && (
					<div className="mb-6 p-4 bg-red-900/20 border border-red-900 rounded-lg text-red-400">{error}</div>
				)}

				{loading && session && !sessionData && (
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

			{selectedEvent && sessionData && (
				<EventDetailsPanel agents={[sessionData.mainAgent, ...sessionData.mainAgent.children]} />
			)}
		</>
	)
}
