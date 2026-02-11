import {join, resolve} from "node:path"

// Get the default Claude projects directory
export const CLAUDE_PROJECTS_DIR = join(process.env.HOME || "~", ".claude", "projects")

// Security: Validate directory parameter to prevent path traversal
export function isValidDirectory(directory: string): boolean {
	// Reject if contains ".." or path separators
	return !directory.includes("..") && !directory.includes("/") && !directory.includes("\\")
}

// Security: Validate session path to ensure it's within CLAUDE_PROJECTS_DIR
export function isValidSessionPath(sessionPath: string): boolean {
	const resolvedPath = resolve(sessionPath)
	const resolvedBaseDir = resolve(CLAUDE_PROJECTS_DIR)
	return resolvedPath.startsWith(resolvedBaseDir)
}
