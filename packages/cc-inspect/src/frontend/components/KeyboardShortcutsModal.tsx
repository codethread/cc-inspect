import {useEffect, useState} from "react"
import {useHotkeys, useHotkeysContext, useRecordHotkeys} from "react-hotkeys-hook"
import {
	CONFIGURABLE_BINDINGS,
	formatHotkey,
	formatRecordedKeys,
	recordedKeysToBinding,
	SCOPES,
	useKeybindingsStore,
} from "../stores/keybindings-store"

export function KeyboardShortcutsModal({onClose}: {onClose: () => void}) {
	const {getKeys, updateBinding, resetBinding, customKeys} = useKeybindingsStore()
	const {enableScope, disableScope} = useHotkeysContext()
	const [editingId, setEditingId] = useState<string | null>(null)
	const [keys, {start, stop, isRecording}] = useRecordHotkeys()

	// Activate MODAL scope while open: prevents global shortcuts from firing during capture
	useEffect(() => {
		enableScope(SCOPES.MODAL)
		disableScope(SCOPES.GLOBAL)
		return () => {
			disableScope(SCOPES.MODAL)
			enableScope(SCOPES.GLOBAL)
		}
	}, [enableScope, disableScope])

	useHotkeys("escape", onClose, {enabled: !isRecording, scopes: [SCOPES.MODAL]})

	const startRecording = (id: string) => {
		setEditingId(id)
		start()
	}

	const saveRecording = () => {
		if (editingId && keys.size > 0) {
			updateBinding(editingId, recordedKeysToBinding(keys))
		}
		stop()
		setEditingId(null)
	}

	const cancelRecording = () => {
		stop()
		setEditingId(null)
	}

	return (
		<>
			{/* Backdrop */}
			<button
				type="button"
				className="fixed inset-0 bg-black/60 z-50 cursor-default backdrop-blur-sm"
				onClick={isRecording ? cancelRecording : onClose}
				aria-label="Close keyboard shortcuts"
			/>

			<div className="fixed left-1/2 top-[15%] -translate-x-1/2 w-[560px] max-w-[calc(100vw-2rem)] z-50 bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl overflow-hidden">
				{/* Header */}
				<div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
					<div>
						<h2 className="text-sm font-semibold text-zinc-100">Keyboard shortcuts</h2>
						<p className="text-xs text-zinc-500 mt-0.5">Click a shortcut to record a new key combination</p>
					</div>
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={() => useKeybindingsStore.getState().resetAll()}
							className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors cursor-pointer px-2 py-1"
						>
							Reset all
						</button>
						<button
							type="button"
							onClick={onClose}
							className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer"
						>
							<svg
								className="w-4 h-4"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
								aria-hidden="true"
							>
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
							</svg>
						</button>
					</div>
				</div>

				{/* Bindings list */}
				<div className="divide-y divide-zinc-800/60">
					{CONFIGURABLE_BINDINGS.map((binding) => {
						const currentKeys = getKeys(binding.id)
						const isCustomized = !!customKeys[binding.id]
						const isEditing = editingId === binding.id
						const liveDisplay =
							isEditing && isRecording ? (keys.size > 0 ? formatRecordedKeys(keys) : "Press keys…") : null

						return (
							<div key={binding.id} className="flex items-center gap-4 px-5 py-3.5">
								<div className="flex-1 min-w-0">
									<div className="text-sm text-zinc-200">{binding.label}</div>
									<div className="text-xs text-zinc-600 mt-0.5">{binding.description}</div>
								</div>

								<div className="flex items-center gap-2 flex-shrink-0">
									{isEditing ? (
										<>
											{/* Live capture display */}
											<span
												className={`font-mono text-xs px-2.5 py-1.5 rounded-lg border min-w-[80px] text-center ${
													keys.size > 0
														? "bg-blue-500/10 border-blue-500/40 text-blue-300"
														: "bg-zinc-800/60 border-zinc-700 text-zinc-500 animate-pulse"
												}`}
											>
												{liveDisplay}
											</span>
											<button
												type="button"
												onClick={saveRecording}
												disabled={keys.size === 0}
												className="text-xs px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors cursor-pointer"
											>
												Save
											</button>
											<button
												type="button"
												onClick={cancelRecording}
												className="text-xs px-2.5 py-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer"
											>
												Cancel
											</button>
										</>
									) : (
										<>
											{/* Current binding display */}
											<button
												type="button"
												onClick={() => startRecording(binding.id)}
												title="Click to record a new shortcut"
												className="font-mono text-xs px-2.5 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800/60 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100 hover:bg-zinc-800 transition-colors cursor-pointer"
											>
												{formatHotkey(currentKeys)}
											</button>
											{isCustomized && (
												<button
													type="button"
													onClick={() => resetBinding(binding.id)}
													className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors cursor-pointer"
													title={`Reset to default (${formatHotkey(binding.defaultKeys)})`}
												>
													Reset
												</button>
											)}
										</>
									)}
								</div>
							</div>
						)
					})}
				</div>

				{/* Footer hint */}
				<div className="px-5 py-3 border-t border-zinc-800 text-xs text-zinc-600">
					Escape is not configurable — it always closes the current panel or dismisses the selection.
				</div>
			</div>
		</>
	)
}
