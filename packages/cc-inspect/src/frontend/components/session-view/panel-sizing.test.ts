import {describe, expect, it} from "bun:test"
import {
	clampPanelSize,
	getPanelBreakpoint,
	getPanelBreakpointFallbackOrder,
	loadPanelSizesFromStorage,
	resolvePanelSize,
	updatePanelSizeForBreakpoint,
	type PersistedPanelSizes,
} from "./panel-sizing"

describe("getPanelBreakpoint", () => {
	it.each([
		{viewportWidth: 900, expected: "small"},
		{viewportWidth: 1199, expected: "small"},
		{viewportWidth: 1200, expected: "medium"},
		{viewportWidth: 1599, expected: "medium"},
		{viewportWidth: 1600, expected: "large"},
	] as const)("returns $expected for viewport $viewportWidth", ({viewportWidth, expected}) => {
		expect(getPanelBreakpoint(viewportWidth)).toBe(expected)
	})
})

describe("getPanelBreakpointFallbackOrder", () => {
	it.each([
		{breakpoint: "small", expected: ["small", "large", "medium"]},
		{breakpoint: "medium", expected: ["medium", "small", "large"]},
		{breakpoint: "large", expected: ["large", "medium", "small"]},
	] as const)("returns $expected for $breakpoint", ({breakpoint, expected}) => {
		expect(getPanelBreakpointFallbackOrder(breakpoint)).toEqual([...expected])
	})
})

describe("resolvePanelSize", () => {
	const sizes: PersistedPanelSizes = {
		outline: {small: 210, large: 320},
		detail: {small: 380, medium: 500},
	}

	it("uses the exact breakpoint value when available", () => {
		expect(resolvePanelSize({panel: "detail", breakpoint: "medium", sizes})).toBe(500)
	})

	it("falls back to the breakpoint below first", () => {
		expect(resolvePanelSize({panel: "outline", breakpoint: "medium", sizes})).toBe(210)
	})

	it("wraps to larger breakpoints after checking below", () => {
		expect(
			resolvePanelSize({panel: "outline", breakpoint: "medium", sizes: {outline: {large: 300}, detail: {}}}),
		).toBe(300)
	})

	it("returns default size when no value exists anywhere", () => {
		expect(resolvePanelSize({panel: "outline", breakpoint: "small", sizes: {outline: {}, detail: {}}})).toBe(
			220,
		)
	})

	it("clamps fallback value to active breakpoint bounds", () => {
		expect(
			resolvePanelSize({panel: "detail", breakpoint: "small", sizes: {outline: {}, detail: {large: 999}}}),
		).toBe(520)
	})
})

describe("updatePanelSizeForBreakpoint", () => {
	it("updates only the active breakpoint and clamps value", () => {
		const next = updatePanelSizeForBreakpoint({
			breakpoint: "medium",
			panel: "outline",
			size: 999,
			sizes: {outline: {small: 200}, detail: {large: 450}},
		})

		expect(next).toEqual({
			outline: {small: 200, medium: 380},
			detail: {large: 450},
		})
	})
})

describe("loadPanelSizesFromStorage", () => {
	it("returns defaults when payload is invalid", () => {
		const storage = {
			getItem: () => "not-json",
		}
		expect(loadPanelSizesFromStorage(storage)).toEqual({outline: {}, detail: {}})
	})

	it("clamps loaded values by breakpoint", () => {
		const storage = {
			getItem: () => JSON.stringify({outline: {small: 0}, detail: {large: 2000}}),
		}
		expect(loadPanelSizesFromStorage(storage)).toEqual({
			outline: {small: clampPanelSize("outline", "small", 0), medium: undefined, large: undefined},
			detail: {small: undefined, medium: undefined, large: clampPanelSize("detail", "large", 2000)},
		})
	})
})
