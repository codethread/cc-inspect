import {Outlet, createRootRoute} from "@tanstack/react-router"
import "../index.css"

export const Route = createRootRoute({
	component: RootLayout,
})

function RootLayout() {
	return (
		<div className="min-h-screen bg-gray-950 text-gray-100">
			<Outlet />
		</div>
	)
}
