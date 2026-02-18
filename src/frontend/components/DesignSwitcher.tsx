const DESIGNS = [
	{path: "/columns", label: "Columns", title: "Three-panel explorer with agent drill-down"},
	{path: "/matrix", label: "Matrix", title: "Agent-column grid with collapsible sub-agents"},
	{path: "/reader", label: "Reader", title: "Structured document reader with turn grouping"},
] as const

export function DesignSwitcher() {
	const currentPath = window.location.pathname
	const params = window.location.search

	return (
		<nav className="flex items-center gap-1 bg-gray-900 border border-gray-700 rounded-full px-1 py-1">
			{DESIGNS.map((design) => {
				const isActive = currentPath === design.path
				return (
					<a
						key={design.path}
						href={`${design.path}${params}`}
						className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
							isActive ? "bg-blue-600 text-white" : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
						}`}
						title={design.title}
					>
						{design.label}
					</a>
				)
			})}
		</nav>
	)
}
