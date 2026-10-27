// A brain's mark. Claude's keeps its own colour; Codex's and OpenCode's are
// one colour in their sources, so they're drawn in the text colour around
// them (a tinted icon), which keeps them visible in light and dark themes alike.

import { PaperIcon } from "@mileniumhq/paperui";
import CLAUDE from "../assets/brains/claude-code.svg?url";
import CODEX from "../assets/brains/codex.svg?url";
import OPENCODE from "../assets/brains/opencode.svg?url";
import type { Harness } from "../contract";

const MONO: Partial<Record<Harness, string>> = { codex: CODEX, opencode: OPENCODE };

export default function BrainLogo(props: { harness: Harness }) {
    return <PaperIcon src={MONO[props.harness] ?? CLAUDE} tint={MONO[props.harness] !== undefined} />;
}
