import { For } from "solid-js";
import { PaperCode, PaperText } from "@mileniumhq/paperui";
import styles from "../site.module.css";

// The commands that install Paperboard from a terminal. Server-rendered into
// #site-install for the static page, then rendered again by entry-client so
// each one's copy button works.
const COMMANDS = [
    { title: "Linux and macOS", command: "curl -fsSL https://i.paperboard.dev | sh", language: "bash" },
    // Prism has no PowerShell grammar here: it shows as plain text
    { title: "Windows (PowerShell)", command: "irm https://i.paperboard.dev | iex", language: undefined },
    { title: "With Node", command: "npx @mileniumhq/paperboard", language: "bash" },
];

export function InstallCommands() {
    return (
        <div class={styles.stack}>
            <For each={COMMANDS}>
                {(item) => (
                    <div class={styles.section}>
                        <PaperText preset="caption" color="text-subtle">{item.title}</PaperText>
                        <PaperCode block copyable wrap language={item.language}>{item.command}</PaperCode>
                    </div>
                )}
            </For>
        </div>
    );
}
