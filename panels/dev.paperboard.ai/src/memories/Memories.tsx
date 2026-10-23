// What the agent remembers. Nothing yet: memory isn't one of its tools.

import { PaperEmptyState } from "@mileniumhq/paperui";
import type { Agent } from "../lib/agent";

export default function Memories(props: { agent: Agent }) {
    const name = () => props.agent.state.settings?.name ?? "Your agent";
    return <PaperEmptyState icon="neurology" title="Nothing yet" description={`${name()} doesn't keep memories yet.`} />;
}
