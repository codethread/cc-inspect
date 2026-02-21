import {create} from "zustand"

interface PickerState {
	open: boolean
	dir: string
	setOpen: (open: boolean) => void
	setDir: (dir: string) => void
}

export const usePickerStore = create<PickerState>((set) => ({
	open: false,
	dir: "",
	setOpen: (open) => set({open}),
	setDir: (dir) => set({dir}),
}))
