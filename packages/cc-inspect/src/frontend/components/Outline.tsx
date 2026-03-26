import type {AgentNode} from "#types"
import {getAgentColorSet} from "./session-view/agent-colors"
import type {Turn} from "./session-view/types"

export function Outline({
	turns,
	agents,
	mainAgentId,
	activeTurnId,
	onNavigate,
}: {
	turns: Turn[]
	agents: AgentNode[]
	mainAgentId: string
	activeTurnId: string | null
	onNavigate: (turnId: string) => void
}) {
	const outlineItems = turns.filter((t) => t.kind === "user" || t.kind === "agent-spawn")

	let userMsgIndex = 0

	return (
		<nav className="py-4">
			<div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider px-4 mb-3">Outline</div>
			<div className="space-y-0.5">
				{outlineItems.map((turn) => {
					const isRealUser = turn.kind === "user" && turn.agentId === mainAgentId
					const isSpawn = turn.kind === "agent-spawn"
					const isSubAgentUser = turn.kind === "user" && turn.agentId !== mainAgentId
					const colors = getAgentColorSet(agents, turn.agentId)
					const isActive = activeTurnId === turn.id

					if (isRealUser) {
						userMsgIndex++
					}

					return (
						<button
							key={turn.id}
							type="button"
							onClick={() => onNavigate(turn.id)}
							className={`w-full text-left py-1.5 text-sm transition-colors cursor-pointer flex items-start gap-2 ${
								isSubAgentUser || isSpawn ? "pl-8 pr-4" : "px-4"
							} ${
								isActive
									? "bg-zinc-800 text-zinc-100"
									: "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
							}`}
						>
							<span className="flex-shrink-0 mt-0.5">
								{isRealUser ? (
									<span className="text-sky-400 font-mono text-xs font-bold">{userMsgIndex}</span>
								) : isSpawn ? (
									<span
										className="w-2 h-2 rounded-full inline-block mt-0.5"
										style={{backgroundColor: colors.dot}}
									/>
								) : (
									<span className="text-zinc-600 font-mono text-xs">&rsaquo;</span>
								)}
							</span>
							<span className={`truncate leading-snug ${isSubAgentUser || isSpawn ? "text-xs" : ""}`}>
								{turn.summary || "..."}
							</span>
						</button>
					)
				})}
			</div>
		</nav>
	)
}
