import {useEffect, useRef} from "react"
import type {SessionData, SessionHandle} from "#types"
import {useHotkeys} from "react-hotkeys-hook"
import {useDirectories, useSessions} from "../api"
import {usePickerStore} from "../stores/picker-store"
import {useSessionStore} from "../stores/session-store"
import {formatProjectName} from "./session-view/helpers"

export function SessionPicker({
	sessionData,
	onSelect,
}: {
	sessionData: SessionData | null
	onSelect: (path: string) => void
}) {
	const sessionPath = useSessionStore((s) => s.sessionPath)
	const {open, dir, setOpen, setDir} = usePickerStore()
	const {data: directories = []} = useDirectories()
	const {data: sessions = [], isLoading} = useSessions(dir)
	const ref = useRef<HTMLDivElement>(null)

	useEffect(() => {
		if (sessionPath && directories.length > 0 && !dir) {
			const match = directories.find((d) => sessionPath.includes(d))
			if (match) setDir(match)
		}
	}, [sessionPath, directories, dir, setDir])

	useHotkeys("escape", () => setOpen(false), {enabled: open})

	useEffect(() => {
		if (!open) return
		function handleClick(e: MouseEvent) {
			if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
		}
		document.addEventListener("mousedown", handleClick)
		return () => document.removeEventListener("mousedown", handleClick)
	}, [open, setOpen])

	return (
		<div ref={ref} className="relative">
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
			>
				<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeWidth={1.5}
						d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
					/>
				</svg>
				{sessionData ? (
					<span className="flex items-center gap-2">
						{dir && <span className="text-xs text-zinc-500">{formatProjectName(dir)}</span>}
						<span className="font-mono text-xs">{sessionData.sessionId.slice(0, 14)}</span>
					</span>
				) : (
					<span>Open session</span>
				)}
			</button>
			{open && (
				<div className="absolute top-full left-0 mt-2 w-80 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl z-50 overflow-hidden">
					<div className="p-3 border-b border-zinc-800">
						<select
							className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200"
							value={dir}
							onChange={(e) => setDir(e.target.value)}
						>
							<option value="">Select project...</option>
							{directories.map((d) => (
								<option key={d} value={d}>
									{formatProjectName(d)}
								</option>
							))}
						</select>
					</div>
					<div className="max-h-60 overflow-y-auto">
						{isLoading && dir && <div className="p-3 text-sm text-zinc-500">Loading...</div>}
						{!dir && <div className="p-3 text-sm text-zinc-600">Choose a project first</div>}
						{dir && !isLoading && sessions.length === 0 && (
							<div className="p-3 text-sm text-zinc-600">No sessions</div>
						)}
						{sessions.map((s: SessionHandle) => (
							<button
								key={s.sessionFilePath}
								type="button"
								onClick={() => {
									onSelect(s.sessionFilePath)
									setOpen(false)
								}}
								className={`w-full text-left px-3 py-2 text-sm border-b border-zinc-800/50 last:border-0 transition-colors cursor-pointer ${
									s.sessionFilePath === sessionPath
										? "bg-zinc-800 text-zinc-100"
										: "hover:bg-zinc-800 text-zinc-300"
								}`}
							>
								<span className="font-mono text-xs text-zinc-500">{s.id.slice(0, 14)}</span>
							</button>
						))}
					</div>
				</div>
			)}
		</div>
	)
}
