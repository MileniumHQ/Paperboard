// What the agent can reach beyond its computer. Nothing to show yet.

import { PaperEmptyState } from "@mileniumhq/paperui";
import type { Agent } from "../lib/agent";

export default function Tools(props: { agent: Agent }) {
    const name = () => props.agent.state.settings?.name ?? "Your agent";
    return <PaperEmptyState icon="construction" title="Nothing yet" description={`${name()} has no extra tools yet.`} />;
}
