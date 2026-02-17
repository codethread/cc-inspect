import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {RouterProvider, createRouter} from "@tanstack/react-router"
import {createRoot} from "react-dom/client"
import {routeTree} from "./routeTree.gen"

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: false,
			retry: false,
		},
	},
})

const router = createRouter({routeTree})

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router
	}
}

function start() {
	// biome-ignore lint/style/noNonNullAssertion: root or die
	const root = createRoot(document.getElementById("root")!)
	root.render(
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
		</QueryClientProvider>,
	)
}

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", start)
} else {
	start()
}
