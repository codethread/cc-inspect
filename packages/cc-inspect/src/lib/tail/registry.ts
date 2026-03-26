import type {ServerWebSocket} from "bun"
import {LOG_MESSAGE, LOG_MODULE} from "../event-catalog"
import {getServerLogger} from "../log/server-instance"
import {SessionTailer} from "./session-tailer"

const log = () => getServerLogger(LOG_MODULE.TAIL_REGISTRY)

interface SessionTailerOptions {
	sessionFilePath: string
	sessionAgentDir: string
	sessionId: string
}

export class TailerRegistry {
	private tailers = new Map<string, SessionTailer>()
	private maxTailers: number

	constructor(maxTailers = 10) {
		this.maxTailers = maxTailers
	}

	getOrCreate(opts: SessionTailerOptions): SessionTailer | null {
		const key = opts.sessionFilePath
		const existing = this.tailers.get(key)
		if (existing) {
			log().info(LOG_MESSAGE.TAIL_REGISTRY_REF_COUNT, {path: key, action: "reuse"})
			return existing
		}

		if (this.tailers.size >= this.maxTailers) {
			log().warn(LOG_MESSAGE.TAIL_REGISTRY_CAP_REACHED, {max: this.maxTailers})
			return null
		}

		const tailer = new SessionTailer(opts)
		this.tailers.set(key, tailer)
		log().info(LOG_MESSAGE.TAIL_REGISTRY_CREATED, {path: key})
		return tailer
	}

	release(sessionPath: string, ws: ServerWebSocket<unknown>): void {
		const tailer = this.tailers.get(sessionPath)
		if (!tailer) return

		tailer.unsubscribe(ws)
		log().info(LOG_MESSAGE.TAIL_REGISTRY_RELEASED, {path: sessionPath})

		// The SessionTailer handles its own cleanup via grace period + no_subscribers
		if (tailer.getSubscriberCount() === 0) {
			// After grace period, clean up from registry too
			// SessionTailer's grace timer handles stopping; we just need to remove from map
			// Use a timeout slightly longer than the grace period
			setTimeout(() => {
				if (tailer.getSubscriberCount() === 0) {
					this.tailers.delete(sessionPath)
				}
			}, 6000) // grace period is 5s
		}
	}
}
