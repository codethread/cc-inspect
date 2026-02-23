import {useMemo, useState} from "react"
import type {AgentNode, Event, EventType} from "#types"
import {DetailPanel} from "./DetailPanel"
import {getAgentColorSet} from "./session-view/agent-colors"
import {
	EVENT_TYPE_COLOR,
	EVENT_TYPE_LABEL,
	EVENT_TYPES,
	formatTime,
	getEventSearchableText,
	getEventSummary,
} from "./session-view/helpers"
import {Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList} from "./ui/command"
import {Dialog, DialogContent} from "./ui/dialog"

export function SearchModal({
	events,
	agents,
	sessionFilePath,
	onGoToTimeline,
	onClose,
}: {
	events: Event[]
	agents: AgentNode[]
	sessionFilePath: string | null
	onGoToTimeline: (event: Event) => void
	onClose: () => void
}) {
	const [typeFilter, setTypeFilter] = useState<Set<EventType>>(new Set())
	const [query, setQuery] = useState("")
	const [selectedId, setSelectedId] = useState("")
	const [previewEvent, setPreviewEvent] = useState<Event | null>(null)

	const toggleType = (type: EventType) => {
		const next = new Set(typeFilter)
		if (next.has(type)) next.delete(type)
		else next.add(type)
		setTypeFilter(next)
	}

	const results = useMemo(() => {
		if (!query.trim()) return []
		const q = query.toLowerCase()
		return events
			.filter((e) => {
				if (typeFilter.size > 0 && !typeFilter.has(e.type)) return false
				return getEventSearchableText(e).includes(q)
			})
			.slice(0, 300)
	}, [events, query, typeFilter])

	return (
		<Dialog
			open
			onOpenChange={(v) => {
				if (!v) onClose()
			}}
		>
			<DialogContent
				showCloseButton={false}
				className="p-0 gap-0 bg-zinc-900 border-zinc-700 rounded-2xl top-[10%] translate-y-0 overflow-hidden"
				style={{width: "min(1000px, calc(100vw - 1rem))", maxWidth: "none", height: "78vh"}}
			>
				{/* Two-panel layout */}
				<div className="flex overflow-hidden h-full">
					{/* Left panel: search + results */}
					<div className="w-80 flex-shrink-0 flex flex-col border-r border-zinc-800">
						<Command
							filter={() => 1}
							value={selectedId}
							onValueChange={(id) => {
								setSelectedId(id)
								setPreviewEvent(events.find((e) => e.id === id) ?? null)
							}}
							className="bg-transparent rounded-none h-full flex flex-col"
						>
							{/* Search input */}
							<div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800 flex-shrink-0">
								<svg
									className="w-4 h-4 text-zinc-500 flex-shrink-0"
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
								<CommandInput
									value={query}
									onValueChange={setQuery}
									placeholder="Search events..."
									className="flex-1 bg-transparent text-zinc-100 placeholder-zinc-600 text-sm focus:outline-none border-0 h-auto py-0 px-0"
								/>
								<kbd className="text-xs text-zinc-600 bg-zinc-800 px-1.5 py-0.5 rounded font-mono flex-shrink-0">
									esc
								</kbd>
							</div>

							{/* Type filter chips */}
							<div className="flex flex-wrap gap-1.5 px-4 py-2.5 border-b border-zinc-800 flex-shrink-0">
								{EVENT_TYPES.map((type) => {
									const on = typeFilter.has(type)
									return (
										<button
											key={type}
											type="button"
											onClick={() => toggleType(type)}
											className={`px-2 py-0.5 rounded text-xs font-mono transition-opacity cursor-pointer ${EVENT_TYPE_COLOR[type]} ${
												typeFilter.size === 0
													? "opacity-40 hover:opacity-70"
													: on
														? "opacity-100 ring-1 ring-current"
														: "opacity-20 hover:opacity-40"
											}`}
										>
											{EVENT_TYPE_LABEL[type]}
										</button>
									)
								})}
							</div>

							{/* Column headers */}
							{results.length > 0 && (
								<div className="flex items-center gap-2 px-4 py-1.5 border-b border-zinc-800/60 flex-shrink-0">
									<span className="text-xs text-zinc-600 uppercase tracking-wider w-16 flex-shrink-0">
										Time
									</span>
									<span className="text-xs text-zinc-600 uppercase tracking-wider w-16 flex-shrink-0">
										Type
									</span>
									<span className="text-xs text-zinc-600 uppercase tracking-wider flex-1">Match</span>
								</div>
							)}

							{/* Results list */}
							<CommandList className="flex-1 overflow-y-auto min-h-0 max-h-none">
								{!query.trim() && (
									<CommandEmpty className="px-4 py-10 text-zinc-700 text-sm">
										Type to search all events
									</CommandEmpty>
								)}
								{query.trim() && results.length === 0 && (
									<CommandEmpty className="px-4 py-10 text-zinc-600 text-sm">No events match</CommandEmpty>
								)}
								{results.length > 0 && (
									<CommandGroup className="p-0">
										{results.map((event) => {
											const colors = getAgentColorSet(agents, event.agentId)
											return (
												<CommandItem
													key={event.id}
													value={event.id}
													onSelect={() => {
														onGoToTimeline(event)
														onClose()
													}}
													className="w-full flex items-center gap-2 px-4 py-2 border-b border-zinc-800/50 last:border-0 rounded-none cursor-pointer aria-selected:bg-zinc-800 hover:bg-zinc-800/50"
												>
													<span className="text-xs text-zinc-600 font-mono tabular-nums flex-shrink-0 w-16">
														{formatTime(event.timestamp)}
													</span>
													<span
														className={`text-xs font-mono flex-shrink-0 w-16 ${EVENT_TYPE_COLOR[event.type]}`}
													>
														{EVENT_TYPE_LABEL[event.type]}
													</span>
													{agents.length > 1 && (
														<span
															className="w-1.5 h-1.5 rounded-full flex-shrink-0"
															style={{backgroundColor: colors.dot}}
														/>
													)}
													<span className="text-zinc-400 text-xs truncate">{getEventSummary(event)}</span>
												</CommandItem>
											)
										})}
									</CommandGroup>
								)}
							</CommandList>

							{/* Footer: count + keyboard hints */}
							<div className="flex items-center gap-2 px-4 py-2 border-t border-zinc-800 flex-shrink-0">
								<span className="text-xs text-zinc-600">
									{query.trim() && results.length > 0
										? `${results.length} result${results.length !== 1 ? "s" : ""}`
										: ""}
								</span>
								<div className="flex items-center gap-1.5 ml-auto text-xs text-zinc-600">
									<kbd className="bg-zinc-800 px-1.5 py-0.5 rounded font-mono">↑↓</kbd>
									<kbd className="bg-zinc-800 px-1.5 py-0.5 rounded font-mono">↵</kbd>
									<span>timeline</span>
								</div>
							</div>
						</Command>
					</div>

					{/* Right panel: detail view */}
					<div className="flex-1 min-w-0 min-h-0 flex flex-col">
						{previewEvent ? (
							<DetailPanel
								event={previewEvent}
								allEvents={events}
								agents={agents}
								sessionFilePath={sessionFilePath}
								onNavigate={() => {
									onGoToTimeline(previewEvent)
									onClose()
								}}
							/>
						) : (
							<div className="flex-1 flex items-center justify-center bg-zinc-950 border-l border-zinc-800">
								<div className="text-center px-8">
									<div className="text-zinc-600 text-sm mb-1">No event selected</div>
									<div className="text-zinc-700 text-xs">Type to search, then navigate results</div>
								</div>
							</div>
						)}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	)
}
