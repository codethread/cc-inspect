import type {AgentNode} from "#types"

const AGENT_COLORS = [
	{
		bg: "bg-blue-500/8",
		border: "border-blue-500/20",
		text: "text-blue-400",
		dot: "#60a5fa",
	},
	{
		bg: "bg-violet-500/8",
		border: "border-violet-500/20",
		text: "text-violet-400",
		dot: "#a78bfa",
	},
	{
		bg: "bg-rose-500/8",
		border: "border-rose-500/20",
		text: "text-rose-400",
		dot: "#fb7185",
	},
	{
		bg: "bg-amber-500/8",
		border: "border-amber-500/20",
		text: "text-amber-400",
		dot: "#fbbf24",
	},
	{
		bg: "bg-emerald-500/8",
		border: "border-emerald-500/20",
		text: "text-emerald-400",
		dot: "#34d399",
	},
	{
		bg: "bg-cyan-500/8",
		border: "border-cyan-500/20",
		text: "text-cyan-400",
		dot: "#22d3ee",
	},
] as const

export type AgentColorSet = (typeof AGENT_COLORS)[number]

export function getAgentColorSet(agents: AgentNode[], agentId: string | null): AgentColorSet {
	const idx = agents.findIndex((a) => a.id === agentId)
	const safeIdx = (idx >= 0 ? idx : 0) % AGENT_COLORS.length
	return AGENT_COLORS[safeIdx] ?? AGENT_COLORS[0]
}
