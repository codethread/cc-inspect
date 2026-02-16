// Error types for Claude Code session log parsing

import type {ZodError} from "zod"

/**
 * Detailed error information for parse failures
 */
export class ParseError extends Error {
	public readonly filePath: string
	public readonly lineNumber: number
	public readonly rawLine: string
	public readonly zodError?: ZodError

	constructor(options: {
		message: string
		filePath: string
		lineNumber: number
		rawLine: string
		zodError?: ZodError
	}) {
		super(options.message)
		this.name = "ParseError"
		this.filePath = options.filePath
		this.lineNumber = options.lineNumber
		this.rawLine = options.rawLine
		this.zodError = options.zodError
	}

	override toString(): string {
		const lines = [
			`${this.name}: ${this.message}`,
			`  File: ${this.filePath}`,
			`  Line: ${this.lineNumber}`,
			`  Raw content (first 200 chars): ${this.rawLine.substring(0, 200)}${this.rawLine.length > 200 ? "..." : ""}`,
		]

		if (this.zodError) {
			lines.push(`  Validation errors:`)

			// Parse the original JSON to show actual values
			let parsedData: unknown
			try {
				parsedData = JSON.parse(this.rawLine)
			} catch {
				parsedData = null
			}

			for (const issue of this.zodError.issues) {
				const pathStr = issue.path.length > 0 ? issue.path.join(" → ") : "(root)"
				lines.push(`\n    [${issue.code}] at ${pathStr}`)
				lines.push(`      Message: ${issue.message}`)

				// Show expected/received for type errors
				if (issue.code === "invalid_type" && "expected" in issue && "received" in issue) {
					lines.push(`      Expected: ${String(issue.expected)}`)
					lines.push(`      Received: ${String(issue.received)}`)
				}

				// Show actual value if we can extract it
				if (parsedData && issue.path.length > 0) {
					try {
						let value: unknown = parsedData
						for (const key of issue.path) {
							if (value && typeof value === "object" && typeof key !== "symbol" && key in value) {
								value = (value as Record<string | number, unknown>)[key]
							}
						}
						const valueStr = JSON.stringify(value)
						lines.push(
							`      Actual value: ${valueStr.length > 100 ? `${valueStr.substring(0, 100)}...` : valueStr}`,
						)
					} catch {
						// Can't extract value, skip it
					}
				}

				// Show valid options for enums (checking property existence dynamically)
				if ("options" in issue && Array.isArray(issue.options)) {
					lines.push(`      Valid options: ${issue.options.join(", ")}`)
				}

				// Show constraints for size validations
				if (issue.code === "too_small" && "minimum" in issue && "inclusive" in issue && "type" in issue) {
					lines.push(
						`      Minimum ${issue.inclusive ? "(inclusive)" : "(exclusive)"}: ${String(issue.minimum)}`,
					)
					lines.push(`      Validation type: ${String(issue.type)}`)
				}
				if (issue.code === "too_big" && "maximum" in issue && "inclusive" in issue && "type" in issue) {
					lines.push(
						`      Maximum ${issue.inclusive ? "(inclusive)" : "(exclusive)"}: ${String(issue.maximum)}`,
					)
					lines.push(`      Validation type: ${String(issue.type)}`)
				}

				// Show unrecognized keys
				if (issue.code === "unrecognized_keys" && "keys" in issue && Array.isArray(issue.keys)) {
					lines.push(`      Unrecognized keys: ${issue.keys.join(", ")}`)
				}
			}
		}

		return lines.join("\n")
	}
}
