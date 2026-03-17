import type {AgentNode, EventType} from "#types"
import {SESSION_EVENT_TYPE} from "../../lib/event-catalog"
import {useFilterStore} from "../stores/filter-store"
import {useUIStore} from "../stores/ui-store"
import {getAgentColorSet} from "./session-view/agent-colors"
import {EVENT_TYPES} from "./session-view/helpers"
import {Sheet, SheetContent} from "./ui/sheet"

const MODEL_FAMILIES = ["opus", "sonnet", "haiku"] as const

export function FilterDrawer({
	open,
	onClose,
	agents,
	errorCount,
	availableModels,
}: {
	open: boolean
	onClose: () => void
	agents: AgentNode[]
	errorCount: number
	availableModels: Set<string>
}) {
	const {
		search,
		typeInclude,
		typeExclude,
		agentFilter,
		modelFilter,
		errorsOnly,
		setSearch,
		setTypeInclude,
		setTypeExclude,
		setAgentFilter,
		setModelFilter,
		setErrorsOnly,
	} = useFilterStore()

	const allToolsExpanded = useUIStore((s) => s.allToolsExpanded)
	const setAllToolsExpanded = useUIStore((s) => s.setAllToolsExpanded)
	const allAgentsExpanded = useUIStore((s) => s.allAgentsExpanded)
	const setAllAgentsExpanded = useUIStore((s) => s.setAllAgentsExpanded)

	const toggleAgent = (id: string) => {
		const next = new Set(agentFilter)
		if (next.has(id)) next.delete(id)
		else next.add(id)
		setAgentFilter(next)
	}

	const toggleModel = (family: string) => {
		const next = new Set(modelFilter)
		if (next.has(family)) next.delete(family)
		else next.add(family)
		setModelFilter(next)
	}

	const typeLabels: Record<EventType, string> = {
		[SESSION_EVENT_TYPE.USER_MESSAGE]: "User Messages",
		[SESSION_EVENT_TYPE.ASSISTANT_MESSAGE]: "Assistant Messages",
		[SESSION_EVENT_TYPE.TOOL_USE]: "Tool Calls",
		[SESSION_EVENT_TYPE.TOOL_RESULT]: "Tool Results",
		[SESSION_EVENT_TYPE.THINKING]: "Thinking",
		[SESSION_EVENT_TYPE.AGENT_SPAWN]: "Agent Spawns",
		[SESSION_EVENT_TYPE.SUMMARY]: "Summaries",
	}

	return (
		<Sheet
			open={open}
			onOpenChange={(v) => {
				if (!v) onClose()
			}}
		>
			<SheetContent
				side="right"
				showCloseButton={false}
				className="w-80 bg-zinc-900 border-l border-zinc-700 p-0 flex flex-col gap-0"
			>
				<div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
					<span className="text-sm font-semibold text-zinc-200">Filters</span>
					<button
						type="button"
						onClick={onClose}
						className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
					>
						<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				</div>
				<div className="flex-1 overflow-y-auto p-4 space-y-6">
					{/* Display toggles */}
					<div>
						<span className="block text-xs font-medium text-zinc-400 mb-2">Display</span>
						<div className="space-y-1">
							<button
								type="button"
								onClick={() => setAllToolsExpanded(!allToolsExpanded)}
								className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between transition-colors cursor-pointer ${
									allToolsExpanded
										? "bg-zinc-800 text-zinc-200"
										: "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
								}`}
							>
								<span>Expand tool calls</span>
								<svg
									className={`w-3.5 h-3.5 transition-transform ${allToolsExpanded ? "rotate-180" : ""}`}
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									aria-hidden="true"
								>
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
								</svg>
							</button>
							<button
								type="button"
								onClick={() => setAllAgentsExpanded(!allAgentsExpanded)}
								className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between transition-colors cursor-pointer ${
									allAgentsExpanded
										? "bg-zinc-800 text-zinc-200"
										: "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
								}`}
							>
								<span>Expand agents</span>
								<svg
									className={`w-3.5 h-3.5 transition-transform ${allAgentsExpanded ? "rotate-180" : ""}`}
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									aria-hidden="true"
								>
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
								</svg>
							</button>
						</div>
					</div>

					<label className="block">
						<span className="block text-xs font-medium text-zinc-400 mb-1.5">Search</span>
						<input
							type="text"
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							placeholder="Filter by text..."
							className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors"
						/>
					</label>

					{errorCount > 0 && (
						<div>
							<span className="block text-xs font-medium text-zinc-400 mb-2">Errors</span>
							<button
								type="button"
								onClick={() => setErrorsOnly(!errorsOnly)}
								className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors cursor-pointer ${
									errorsOnly
										? "bg-red-500/10 text-red-400 border border-red-500/25"
										: "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 border border-transparent"
								}`}
							>
								<span className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0" />
								Show only failures ({errorCount})
							</button>
						</div>
					)}

					{/* Model filter */}
					{availableModels.size > 0 && (
						<div>
							<div className="flex items-center justify-between mb-2">
								<span className="text-xs font-medium text-zinc-400">Model</span>
								{modelFilter.size > 0 && (
									<button
										type="button"
										onClick={() => setModelFilter(new Set())}
										className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors cursor-pointer"
									>
										Reset
									</button>
								)}
							</div>
							<div className="flex flex-wrap gap-1.5">
								{MODEL_FAMILIES.filter((f) => availableModels.has(f)).map((family) => {
									const active = modelFilter.size === 0 || modelFilter.has(family)
									return (
										<button
											key={family}
											type="button"
											onClick={() => toggleModel(family)}
											className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
												active
													? "bg-zinc-800 text-zinc-200"
													: "text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800/50"
											}`}
										>
											{family}
										</button>
									)
								})}
							</div>
						</div>
					)}

					<div>
						<div className="flex items-center justify-between mb-2">
							<span className="text-xs font-medium text-zinc-400">Event Types</span>
							{(typeInclude.size > 0 || typeExclude.size > 0) && (
								<button
									type="button"
									onClick={() => {
										setTypeInclude(new Set())
										setTypeExclude(new Set())
									}}
									className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors cursor-pointer"
								>
									Reset
								</button>
							)}
						</div>
						<div className="space-y-0.5">
							{EVENT_TYPES.map((t) => {
								const isIncluded = typeInclude.has(t)
								const isExcluded = typeExclude.has(t)
								return (
									<div
										key={t}
										className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-sm ${
											isExcluded
												? "text-zinc-700 line-through"
												: isIncluded
													? "bg-zinc-800 text-zinc-100"
													: "text-zinc-300"
										}`}
									>
										<span className="flex-1">{typeLabels[t]}</span>
										<button
											type="button"
											onClick={() => {
												const next = new Set(typeInclude)
												if (isIncluded) {
													next.delete(t)
												} else {
													next.add(t)
													const ex = new Set(typeExclude)
													ex.delete(t)
													setTypeExclude(ex)
												}
												setTypeInclude(next)
											}}
											className={`p-1 rounded transition-colors cursor-pointer ${
												isIncluded ? "text-blue-400 hover:text-blue-300" : "text-zinc-600 hover:text-zinc-400"
											}`}
											title="Focus on this type"
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
													d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
												/>
												<path
													strokeLinecap="round"
													strokeLinejoin="round"
													strokeWidth={2}
													d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
												/>
											</svg>
										</button>
										<button
											type="button"
											onClick={() => {
												const next = new Set(typeExclude)
												if (isExcluded) {
													next.delete(t)
												} else {
													next.add(t)
													const inc = new Set(typeInclude)
													inc.delete(t)
													setTypeInclude(inc)
												}
												setTypeExclude(next)
											}}
											className={`p-1 rounded transition-colors cursor-pointer ${
												isExcluded ? "text-zinc-400 hover:text-zinc-300" : "text-zinc-600 hover:text-zinc-400"
											}`}
											title="Hide this type"
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
													d="M6 18L18 6M6 6l12 12"
												/>
											</svg>
										</button>
									</div>
								)
							})}
						</div>
					</div>

					{agents.length > 1 && (
						<div>
							<span className="block text-xs font-medium text-zinc-400 mb-2">Agents</span>
							<div className="space-y-1">
								{agents.map((a) => {
									const colors = getAgentColorSet(agents, a.id)
									const active = agentFilter.size === 0 || agentFilter.has(a.id)
									return (
										<button
											key={a.id}
											type="button"
											onClick={() => toggleAgent(a.id)}
											className={`w-full text-left px-3 py-1.5 rounded-lg text-sm flex items-center gap-2 transition-colors cursor-pointer ${
												active ? "bg-zinc-800 text-zinc-200" : "text-zinc-600 hover:text-zinc-400"
											}`}
										>
											<span
												className="w-2.5 h-2.5 rounded-full flex-shrink-0"
												style={{
													backgroundColor: active ? colors.dot : "#52525b",
												}}
											/>
											{a.name ?? a.id.slice(0, 12)}
										</button>
									)
								})}
							</div>
						</div>
					)}
				</div>
			</SheetContent>
		</Sheet>
	)
}
