import {z} from "zod"

export const PANEL_BREAKPOINTS = ["small", "medium", "large"] as const
export type PanelBreakpoint = (typeof PANEL_BREAKPOINTS)[number]

export const PANEL_IDS = ["outline", "detail"] as const
export type PanelId = (typeof PANEL_IDS)[number]

interface PanelSizeMap {
	small?: number
	medium?: number
	large?: number
}

export interface PersistedPanelSizes {
	outline: PanelSizeMap
	detail: PanelSizeMap
}

export const PANEL_SIZES_STORAGE_KEY = "cc-inspect-panel-sizes"

const BREAKPOINT_MEDIUM_MIN = 1200
const BREAKPOINT_LARGE_MIN = 1600

const panelSizeMapSchema = z.object({
	small: z.number().finite().optional(),
	medium: z.number().finite().optional(),
	large: z.number().finite().optional(),
})

const persistedPanelSizesSchema = z.object({
	outline: panelSizeMapSchema,
	detail: panelSizeMapSchema,
})

const defaultPersistedPanelSizes: PersistedPanelSizes = {
	outline: {},
	detail: {},
}

const panelSizeDefaults: Record<PanelId, Record<PanelBreakpoint, number>> = {
	outline: {
		small: 220,
		medium: 240,
		large: 240,
	},
	detail: {
		small: 360,
		medium: 420,
		large: 450,
	},
}

const panelSizeBounds: Record<PanelId, Record<PanelBreakpoint, {min: number; max: number}>> = {
	outline: {
		small: {min: 170, max: 320},
		medium: {min: 180, max: 380},
		large: {min: 200, max: 420},
	},
	detail: {
		small: {min: 280, max: 520},
		medium: {min: 320, max: 620},
		large: {min: 340, max: 760},
	},
}

export function getPanelBreakpoint(viewportWidth: number): PanelBreakpoint {
	if (viewportWidth >= BREAKPOINT_LARGE_MIN) return "large"
	if (viewportWidth >= BREAKPOINT_MEDIUM_MIN) return "medium"
	return "small"
}

export function getPanelBreakpointFallbackOrder(breakpoint: PanelBreakpoint): PanelBreakpoint[] {
	switch (breakpoint) {
		case "small":
			return ["small", "large", "medium"]
		case "medium":
			return ["medium", "small", "large"]
		case "large":
			return ["large", "medium", "small"]
	}
}

export function clampPanelSize(panel: PanelId, breakpoint: PanelBreakpoint, size: number): number {
	const bounds = panelSizeBounds[panel][breakpoint]
	return Math.min(bounds.max, Math.max(bounds.min, Math.round(size)))
}

export function getDefaultPanelSize(panel: PanelId, breakpoint: PanelBreakpoint): number {
	return panelSizeDefaults[panel][breakpoint]
}

export function resolvePanelSize({
	panel,
	breakpoint,
	sizes,
}: {
	panel: PanelId
	breakpoint: PanelBreakpoint
	sizes: PersistedPanelSizes
}): number {
	for (const candidate of getPanelBreakpointFallbackOrder(breakpoint)) {
		const candidateSize = sizes[panel][candidate]
		if (typeof candidateSize === "number") {
			return clampPanelSize(panel, breakpoint, candidateSize)
		}
	}
	return getDefaultPanelSize(panel, breakpoint)
}

export function loadPanelSizesFromStorage(storage: Pick<Storage, "getItem"> | null): PersistedPanelSizes {
	if (!storage) return defaultPersistedPanelSizes

	try {
		const raw = storage.getItem(PANEL_SIZES_STORAGE_KEY)
		if (!raw) return defaultPersistedPanelSizes
		const parsed = persistedPanelSizesSchema.safeParse(JSON.parse(raw))
		if (!parsed.success) return defaultPersistedPanelSizes

		const data = parsed.data
		return {
			outline: {
				small:
					typeof data.outline.small === "number"
						? clampPanelSize("outline", "small", data.outline.small)
						: undefined,
				medium:
					typeof data.outline.medium === "number"
						? clampPanelSize("outline", "medium", data.outline.medium)
						: undefined,
				large:
					typeof data.outline.large === "number"
						? clampPanelSize("outline", "large", data.outline.large)
						: undefined,
			},
			detail: {
				small:
					typeof data.detail.small === "number"
						? clampPanelSize("detail", "small", data.detail.small)
						: undefined,
				medium:
					typeof data.detail.medium === "number"
						? clampPanelSize("detail", "medium", data.detail.medium)
						: undefined,
				large:
					typeof data.detail.large === "number"
						? clampPanelSize("detail", "large", data.detail.large)
						: undefined,
			},
		}
	} catch {
		return defaultPersistedPanelSizes
	}
}

export function savePanelSizesToStorage({
	storage,
	sizes,
}: {
	storage: Pick<Storage, "setItem"> | null
	sizes: PersistedPanelSizes
}): void {
	if (!storage) return
	storage.setItem(PANEL_SIZES_STORAGE_KEY, JSON.stringify(sizes))
}

export function updatePanelSizeForBreakpoint({
	breakpoint,
	panel,
	size,
	sizes,
}: {
	breakpoint: PanelBreakpoint
	panel: PanelId
	size: number
	sizes: PersistedPanelSizes
}): PersistedPanelSizes {
	return {
		...sizes,
		[panel]: {
			...sizes[panel],
			[breakpoint]: clampPanelSize(panel, breakpoint, size),
		},
	}
}
