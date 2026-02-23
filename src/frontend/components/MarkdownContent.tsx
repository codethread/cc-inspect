import Markdown from "markdown-to-jsx"
import type {ComponentPropsWithoutRef} from "react"

interface MarkdownContentProps {
	children: string
	className?: string
}

export function MarkdownContent({children, className = ""}: MarkdownContentProps) {
	return (
		<Markdown
			className={className}
			options={{
				overrides: {
					h1: {
						component: "h1",
						props: {
							className: "text-2xl font-bold text-gray-100 mb-4 mt-6 first:mt-0",
						},
					},
					h2: {
						component: "h2",
						props: {
							className: "text-xl font-bold text-gray-100 mb-3 mt-5 first:mt-0",
						},
					},
					h3: {
						component: "h3",
						props: {
							className: "text-lg font-semibold text-gray-200 mb-3 mt-4 first:mt-0",
						},
					},
					h4: {
						component: "h4",
						props: {
							className: "text-base font-semibold text-gray-200 mb-2 mt-3 first:mt-0",
						},
					},
					h5: {
						component: "h5",
						props: {
							className: "text-sm font-semibold text-gray-300 mb-2 mt-3 first:mt-0",
						},
					},
					h6: {
						component: "h6",
						props: {
							className: "text-sm font-semibold text-gray-400 mb-2 mt-2 first:mt-0",
						},
					},
					p: {
						component: "p",
						props: {
							className: "text-sm text-gray-300 mb-3 last:mb-0 leading-relaxed",
						},
					},
					a: {
						component: "a",
						props: {
							className: "text-blue-400 hover:text-blue-300 underline transition-colors",
							target: "_blank",
							rel: "noopener noreferrer",
						},
					},
					ul: {
						component: "ul",
						props: {
							className: "list-disc list-inside mb-3 text-sm text-gray-300 space-y-1",
						},
					},
					ol: {
						component: "ol",
						props: {
							className: "list-decimal list-inside mb-3 text-sm text-gray-300 space-y-1",
						},
					},
					li: {
						component: "li",
						props: {
							className: "text-gray-300 leading-relaxed",
						},
					},
					code: {
						component: "code",
						props: {
							className: "bg-gray-950 text-gray-200 px-1.5 py-0.5 rounded text-xs font-mono",
						},
					},
					pre: {
						component: "pre",
						props: {
							className:
								"bg-gray-950 text-gray-200 p-4 rounded border border-gray-700 overflow-x-auto mb-3 text-xs font-mono leading-relaxed",
						},
					},
					blockquote: {
						component: "blockquote",
						props: {
							className: "border-l-4 border-gray-600 pl-4 py-2 mb-3 text-gray-400 italic",
						},
					},
					hr: {
						component: "hr",
						props: {
							className: "border-gray-700 my-4",
						},
					},
					strong: {
						component: "strong",
						props: {
							className: "font-semibold text-gray-100",
						},
					},
					em: {
						component: "em",
						props: {
							className: "italic text-gray-300",
						},
					},
					table: {
						component: ({children: tableChildren, ...tableProps}: ComponentPropsWithoutRef<"table">) => (
							<div className="mb-3 overflow-x-auto rounded-lg border border-cyan-400/15 bg-zinc-950/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
								<table
									{...tableProps}
									className={`min-w-full border-collapse text-sm ${tableProps.className ?? ""}`}
								>
									{tableChildren}
								</table>
							</div>
						),
					},
					thead: {
						component: "thead",
						props: {
							className: "bg-zinc-900/90",
						},
					},
					tbody: {
						component: "tbody",
						props: {
							className: "bg-zinc-950/70",
						},
					},
					tr: {
						component: "tr",
						props: {
							className:
								"border-b border-zinc-800/90 even:bg-cyan-400/[0.03] hover:bg-cyan-300/[0.08] transition-colors",
						},
					},
					th: {
						component: "th",
						props: {
							className:
								"px-4 py-2.5 text-left font-semibold text-zinc-100 border-b border-cyan-400/15 tracking-wide",
						},
					},
					td: {
						component: "td",
						props: {
							className: "px-4 py-2.5 text-zinc-300 border-b border-zinc-800/80 align-top",
						},
					},
				},
			}}
		>
			{children}
		</Markdown>
	)
}
