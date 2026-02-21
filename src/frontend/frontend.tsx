import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {NuqsAdapter} from "nuqs/adapters/react"
import {createRoot} from "react-dom/client"
import {HotkeysProvider} from "react-hotkeys-hook"
import {App} from "./App"
import {INITIAL_ACTIVE_SCOPES} from "./stores/keybindings-store"

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: false,
			retry: false,
		},
	},
})

function start() {
	// biome-ignore lint/style/noNonNullAssertion: root or die
	const root = createRoot(document.getElementById("root")!)
	root.render(
		<NuqsAdapter>
			<HotkeysProvider initiallyActiveScopes={INITIAL_ACTIVE_SCOPES}>
				<QueryClientProvider client={queryClient}>
					<App />
				</QueryClientProvider>
			</HotkeysProvider>
		</NuqsAdapter>,
	)
}

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", start)
} else {
	start()
}
