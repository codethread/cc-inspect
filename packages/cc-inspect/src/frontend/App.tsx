import "./index.css"
import {Toaster} from "sonner"
import {SessionView} from "./components/SessionView"

export function App() {
	return (
		<>
			<SessionView />
			<Toaster theme="dark" position="bottom-center" />
		</>
	)
}
