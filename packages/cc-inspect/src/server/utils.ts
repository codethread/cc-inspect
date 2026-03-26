import {readdir, stat} from "node:fs/promises"
import {join, resolve} from "node:path"

// Get the default Claude projects directory
export const CLAUDE_PROJECTS_DIR = join(process.env.HOME || "~", ".claude", "projects")

// Security: Validate directory parameter to prevent path traversal
export function isValidDirectory(directory: string): boolean {
	// Reject if contains ".." or path separators
	return !directory.includes("..") && !directory.includes("/") && !directory.includes("\\")
}

// Greedily resolve a Claude project directory ID to a human-readable path
// relative to homeDir by matching segments against real directories on the filesystem.
// e.g. "-Users-adam-dev-projects-cc-inspect" + homeDir "/Users/adam" → "dev/projects/cc-inspect"
async function greedyResolve(dir: string, remaining: string): Promise<string[]> {
	if (!remaining) return []
	let entries: string[]
	try {
		const allEntries = await readdir(dir)
		// Only keep directories to avoid files with hyphenated names matching first
		const checks = await Promise.all(
			allEntries.map(async (e) => {
				try {
					const s = await stat(join(dir, e))
					return s.isDirectory() ? e : null
				} catch {
					return null
				}
			}),
		)
		entries = checks.filter((e): e is string => e !== null)
	} catch {
		return [remaining]
	}
	const parts = remaining.split("-")
	for (let len = parts.length; len >= 1; len--) {
		const candidate = parts.slice(0, len).join("-")
		if (entries.includes(candidate)) {
			const rest = parts.slice(len).join("-")
			return [candidate, ...(await greedyResolve(join(dir, candidate), rest))]
		}
	}
	return [remaining]
}

export async function resolveProjectDisplayName(projectId: string, homeDir: string): Promise<string> {
	// Build a dash-encoded version of homeDir to strip from the project id.
	// Require a trailing "-" boundary so "/Users/adam" doesn't match "/Users/adamhall".
	const homeDashPrefix = homeDir.replace(/^\//, "").replace(/\//g, "-")
	const withoutLeadingDash = projectId.replace(/^-/, "")
	const hasHomeBoundary =
		withoutLeadingDash === homeDashPrefix || withoutLeadingDash.startsWith(`${homeDashPrefix}-`)
	if (!hasHomeBoundary) {
		// Fallback: last 2 dash-segments
		return withoutLeadingDash.split("-").slice(-2).join("/")
	}
	const remaining = withoutLeadingDash.slice(homeDashPrefix.length).replace(/^-/, "")
	if (!remaining) {
		// Project is rooted at $HOME itself — show the home dir's basename
		return homeDir.split("/").at(-1) ?? homeDir
	}
	const segments = await greedyResolve(homeDir, remaining)
	return segments.join("/")
}

// Security: Validate session path to ensure it's within CLAUDE_PROJECTS_DIR
export function isValidSessionPath(sessionPath: string): boolean {
	const resolvedPath = resolve(sessionPath)
	const resolvedBaseDir = resolve(CLAUDE_PROJECTS_DIR)
	return resolvedPath.startsWith(resolvedBaseDir)
}
