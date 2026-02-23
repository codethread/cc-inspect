import {create} from "zustand"
import {devtools} from "zustand/middleware"
import {STORE_ACTION, STORE_DEVTOOLS_NAME, STORE_KEY} from "../../lib/event-catalog"
import {withStoreLogging} from "./store-logging-middleware"

interface PickerState {
	open: boolean
	dir: string
	setOpen: (open: boolean) => void
	setDir: (dir: string) => void
}

export const usePickerStore = create<PickerState>()(
	devtools(
		withStoreLogging(STORE_KEY.PICKER, (set) => ({
			open: false,
			dir: "",
			setOpen: (open) => set({open}, false, {type: STORE_ACTION.PICKER.SET_OPEN, open}),
			setDir: (dir) => set({dir}, false, {type: STORE_ACTION.PICKER.SET_DIR, dir}),
		})),
		{
			name: STORE_DEVTOOLS_NAME[STORE_KEY.PICKER],
		},
	),
)
