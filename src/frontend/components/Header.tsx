import {useState} from "react"
import type {SessionData, SessionHandle} from "#types"
import {useDeleteSession} from "../api"

interface HeaderProps {
	sessionData: SessionData | null
	directories: string[]
	selectedDirectory: string
	onDirectoryChange: (dir: string) => void
	loadingDirectories: boolean
	sessions: SessionHandle[]
	selectedSession: string
	onSessionChange: (sessionPath: string) => void
	loadingSessions: boolean
	onSessionDeleted: () => void
}

export function Header({
	sessionData,
	directories,
	selectedDirectory,
	onDirectoryChange,
	loadingDirectories,
	sessions,
	selectedSession,
	onSessionChange,
	loadingSessions,
	onSessionDeleted,
}: HeaderProps) {
	const [copySuccess, setCopySuccess] = useState(false)
	const deleteSession = useDeleteSession()

	const handleCopyPath = async () => {
		if (!selectedSession) return

		try {
			await navigator.clipboard.writeText(selectedSession)
			setCopySuccess(true)
			setTimeout(() => setCopySuccess(false), 2000)
		} catch (err) {
			console.error("Failed to copy:", err)
		}
	}

	const handleDeleteSession = () => {
		if (!selectedSession) return

		const confirmed = window.confirm("Are you sure you want to delete this session?")
		if (!confirmed) return

		deleteSession.mutate(selectedSession, {
			onSuccess: () => onSessionDeleted(),
		})
	}

	return (
		<header className="border-b border-gray-800 bg-gray-900">
			<div className="max-w-[1800px] mx-auto px-6 py-4">
				<div className="flex items-start justify-between gap-6">
					<div className="flex-shrink-0">
						<h1 className="text-2xl font-bold">Claude Code Session Inspector</h1>
						{sessionData && (
							<p className="text-sm text-gray-400 mt-1">
								{sessionData.allEvents.length} events • {sessionData.mainAgent.children.length + 1} agents
							</p>
						)}
					</div>

					{/* Selector controls */}
					<div className="flex-1 flex gap-4 items-start max-w-3xl">
						{/* Directory selection */}
						<div className="flex-1">
							<label htmlFor="directory-select" className="block text-xs font-medium text-gray-400 mb-1">
								Project Directory
							</label>
							<select
								id="directory-select"
								value={selectedDirectory}
								onChange={(e) => onDirectoryChange(e.target.value)}
								disabled={loadingDirectories}
								className="w-full px-3 py-1.5 text-sm bg-gray-800 border border-gray-700 rounded text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
							>
								<option value="">{loadingDirectories ? "Loading..." : "-- Select directory --"}</option>
								{directories.map((dir) => (
									<option key={dir} value={dir}>
										{dir}
									</option>
								))}
							</select>
						</div>

						{/* Session selection */}
						<div className="flex-1">
							<label htmlFor="session-select" className="block text-xs font-medium text-gray-400 mb-1">
								Session
							</label>
							<select
								id="session-select"
								value={selectedSession}
								onChange={(e) => onSessionChange(e.target.value)}
								disabled={!selectedDirectory || loadingSessions || sessions.length === 0}
								className="w-full px-3 py-1.5 text-sm bg-gray-800 border border-gray-700 rounded text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
							>
								<option value="">
									{loadingSessions
										? "Loading..."
										: sessions.length === 0
											? "No sessions"
											: "-- Select session --"}
								</option>
								{sessions.map((session) => (
									<option key={session.id} value={session.sessionFilePath}>
										{session.id}
									</option>
								))}
							</select>
						</div>
					</div>

					{/* Action buttons */}
					{selectedSession && (
						<div className="flex-shrink-0 self-end flex gap-2">
							{/* Copy path button */}
							<button
								type="button"
								onClick={handleCopyPath}
								className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-gray-300 hover:text-gray-100 hover:bg-gray-750 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
								title="Copy session path to clipboard"
							>
								{copySuccess ? (
									<svg
										role="img"
										className="w-5 h-5 text-green-400"
										fill="none"
										viewBox="0 0 24 24"
										stroke="currentColor"
										aria-label="Copied"
									>
										<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
									</svg>
								) : (
									<svg
										role="img"
										className="w-5 h-5"
										fill="none"
										viewBox="0 0 24 24"
										stroke="currentColor"
										aria-label="Copy"
									>
										<path
											strokeLinecap="round"
											strokeLinejoin="round"
											strokeWidth={2}
											d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
										/>
									</svg>
								)}
							</button>

							{/* Delete session button */}
							<button
								type="button"
								onClick={handleDeleteSession}
								disabled={deleteSession.isPending}
								className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-red-400 hover:text-red-300 hover:bg-gray-750 focus:outline-none focus:ring-2 focus:ring-red-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
								title="Delete session"
							>
								{deleteSession.isPending ? (
									<svg
										role="img"
										className="w-5 h-5 animate-spin"
										fill="none"
										viewBox="0 0 24 24"
										aria-label="Deleting"
									>
										<circle
											className="opacity-25"
											cx="12"
											cy="12"
											r="10"
											stroke="currentColor"
											strokeWidth="4"
										/>
										<path
											className="opacity-75"
											fill="currentColor"
											d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
										/>
									</svg>
								) : (
									<svg
										role="img"
										className="w-5 h-5"
										fill="none"
										viewBox="0 0 24 24"
										stroke="currentColor"
										aria-label="Delete"
									>
										<path
											strokeLinecap="round"
											strokeLinejoin="round"
											strokeWidth={2}
											d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
										/>
									</svg>
								)}
							</button>
						</div>
					)}
				</div>
			</div>
		</header>
	)
}
