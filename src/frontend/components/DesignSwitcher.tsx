const DESIGNS = [
	{path: "/v1", label: "V1", title: "Waterfall"},
	{path: "/v2", label: "V2", title: "Conversation"},
	{path: "/v3", label: "V3", title: "Trace"},
	{path: "/v4", label: "V4", title: "Columns"},
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
