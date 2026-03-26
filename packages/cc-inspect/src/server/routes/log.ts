import {LOG_MESSAGE, LOG_MODULE} from "../../lib/event-catalog"
import {LogEntrySchema} from "../../lib/log/types"
import {getLogWriter, getServerLogger} from "../../lib/log/server-instance"

const log = () => getServerLogger(LOG_MODULE.ROUTES_LOG)

// POST /api/log — beacon fallback for client log entries
export async function logHandler(req: Request): Promise<Response> {
	if (req.method !== "POST") {
		return new Response("Method not allowed", {status: 405})
	}

	try {
		const body = await req.json()
		const entries = Array.isArray(body) ? body : [body]
		const writer = getLogWriter()

		for (const raw of entries) {
			const parsed = LogEntrySchema.safeParse({...raw, component: "web"})
			if (parsed.success) {
				writer.write(parsed.data)
			}
		}

		return new Response("ok", {status: 200})
	} catch (err) {
		log().error(LOG_MESSAGE.ROUTE_LOG_BEACON_FAILED, {
			err: err instanceof Error ? err.message : String(err),
		})
		return new Response("bad request", {status: 400})
	}
}
