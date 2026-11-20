import { For } from "solid-js";
import { PaperCode, PaperFlex, PaperText } from "@mileniumhq/paperui";

// The commands that install Paperboard from a terminal. Server-rendered into
// #site-install for the static page, then rendered again by entry-client so
// each one's copy button works.
const COMMANDS = [
    { title: "Linux and macOS", command: "curl -fsSL https://i.paperboard.dev | sh", language: "bash" },
    { title: "With Node", command: "npx @mileniumhq/paperboard", language: "bash" },
];

export function InstallCommands() {
    return (
        <PaperFlex direction="column" gap="full">
            <For each={COMMANDS}>
                {(item) => (
                    <PaperFlex direction="column" gap="half">
                        <PaperText preset="caption" color="text-subtle">{item.title}</PaperText>
                        <PaperCode block copyable wrap language={item.language}>{item.command}</PaperCode>
                    </PaperFlex>
                )}
            </For>
        </PaperFlex>
    );
}
