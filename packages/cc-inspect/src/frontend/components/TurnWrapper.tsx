import type {ReactNode} from "react"
import {useInView} from "react-intersection-observer"

export function TurnWrapper({
	turnId,
	onVisible,
	children,
}: {
	turnId: string
	onVisible: (id: string) => void
	children: ReactNode
}) {
	const {ref} = useInView({
		rootMargin: "-80px 0px -60% 0px",
		threshold: 0,
		onChange: (inView) => {
			if (inView) onVisible(turnId)
		},
	})

	return (
		<div ref={ref} data-turn-id={turnId}>
			{children}
		</div>
	)
}
