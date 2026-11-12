// The row above a phone's on-screen keyboard: the keys a shell needs that the
// keyboard doesn't have. It never takes the keyboard's cursor from the screen
// (a press is cancelled before it can move focus), so the keyboard stays up.
import { For } from "solid-js";
import { PaperButton, PaperFlex, PaperIcon } from "@mileniumhq/paperui";
import type { NamedKey } from "./lib/softKeys";

type Press = { key: NamedKey } | { type: string } | { modifier: "ctrl" | "alt" } | { action: "paste" | "copy" };

interface KeyDef {
    label: string;
    /** the glyph, when the key is drawn as one */
    icon?: string;
    /** what the key is called to a screen reader */
    name: string;
    press: Press;
}

// the order is how often a shell needs them: what fits the width of a phone
// without scrolling comes first, the rest scrolls
const KEYS: KeyDef[] = [
    { label: "Esc", name: "Escape", press: { key: "esc" } },
    { label: "Tab", name: "Tab", press: { key: "tab" } },
    { label: "Ctrl", name: "Control", press: { modifier: "ctrl" } },
    { label: "←", icon: "arrow_back", name: "Left", press: { key: "left" } },
    { label: "↓", icon: "arrow_downward", name: "Down", press: { key: "down" } },
    { label: "↑", icon: "arrow_upward", name: "Up", press: { key: "up" } },
    { label: "→", icon: "arrow_forward", name: "Right", press: { key: "right" } },
    { label: "Paste", icon: "content_paste", name: "Paste", press: { action: "paste" } },
    { label: "Copy", icon: "content_copy", name: "Copy the selection, or the last command's output", press: { action: "copy" } },
    { label: "Alt", name: "Alt", press: { modifier: "alt" } },
    { label: "|", name: "Pipe", press: { type: "|" } },
    { label: "~", name: "Tilde", press: { type: "~" } },
    { label: "/", name: "Slash", press: { type: "/" } },
    { label: "-", name: "Dash", press: { type: "-" } },
    { label: "Home", name: "Home", press: { key: "home" } },
    { label: "End", name: "End", press: { key: "end" } },
    { label: "PgUp", name: "Page up", press: { key: "pageUp" } },
    { label: "PgDn", name: "Page down", press: { key: "pageDown" } },
];

export interface SoftKeysProps {
    ctrl: boolean;
    alt: boolean;
    onToggle: (modifier: "ctrl" | "alt") => void;
    onKey: (key: NamedKey) => void;
    onType: (text: string) => void;
    onCopy: () => void;
    onPaste: () => void;
    onHideKeyboard: () => void;
}

export default function SoftKeys(props: SoftKeysProps) {
    const run = (press: Press) => {
        if ("key" in press) props.onKey(press.key);
        else if ("type" in press) props.onType(press.type);
        else if ("modifier" in press) props.onToggle(press.modifier);
        else if (press.action === "copy") props.onCopy();
        else props.onPaste();
    };
    const latched = (press: Press) => "modifier" in press && props[press.modifier];
    return (
        <PaperFlex
            direction="row"
            align="center"
            gap="half"
            padding="half"
            fullWidth
            background="surface-sunken"
            role="toolbar"
            aria-label="Keys"
            // a press must not move the cursor out of the screen, or the keyboard goes
            onMouseDown={(e: MouseEvent) => e.preventDefault()}
        >
            <PaperFlex direction="row" align="center" gap="half" flex minWidth={0} overflowX="auto">
                <For each={KEYS}>
                    {(def) => (
                        <PaperButton
                            size="small"
                            variant={latched(def.press) ? "primary" : "outline"}
                            icon={Boolean(def.icon)}
                            aria-label={def.name}
                            aria-pressed={"modifier" in def.press ? latched(def.press) : undefined}
                            title={def.name}
                            onClick={() => run(def.press)}
                        >
                            {def.icon ? <PaperIcon>{def.icon}</PaperIcon> : def.label}
                        </PaperButton>
                    )}
                </For>
            </PaperFlex>
            <PaperButton size="small" variant="outline" icon aria-label="Hide keyboard" title="Hide keyboard" onClick={props.onHideKeyboard}>
                <PaperIcon>keyboard_hide</PaperIcon>
            </PaperButton>
        </PaperFlex>
    );
}
