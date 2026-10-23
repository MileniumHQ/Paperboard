// Key names as the agent and the user's view send them (xdotool keysyms,
// joined by +, like ctrl+shift+t or Return), turned into the key events the
// browser's own keyboard would send.

type KeyEvent = Record<string, unknown>;

interface Key {
    key: string;
    code: string;
    vk: number;
    /** what it types, when it types something */
    text?: string;
    shifted?: { key: string; text: string };
}

const MODS: Record<string, { bit: number; key: string; code: string; vk: number }> = {
    alt: { bit: 1, key: "Alt", code: "AltLeft", vk: 18 },
    ctrl: { bit: 2, key: "Control", code: "ControlLeft", vk: 17 },
    super: { bit: 4, key: "Meta", code: "MetaLeft", vk: 91 },
    shift: { bit: 8, key: "Shift", code: "ShiftLeft", vk: 16 },
};
const MOD_NAMES: Record<string, keyof typeof MODS> = {
    alt: "alt", alt_l: "alt", alt_r: "alt", meta: "super", super: "super", super_l: "super", super_r: "super", cmd: "super", command: "super",
    ctrl: "ctrl", control: "ctrl", control_l: "ctrl", control_r: "ctrl", shift: "shift", shift_l: "shift", shift_r: "shift",
};

const NAMED: Record<string, Key> = {
    return: { key: "Enter", code: "Enter", vk: 13, text: "\r" },
    enter: { key: "Enter", code: "Enter", vk: 13, text: "\r" },
    kp_enter: { key: "Enter", code: "NumpadEnter", vk: 13, text: "\r" },
    backspace: { key: "Backspace", code: "Backspace", vk: 8 },
    tab: { key: "Tab", code: "Tab", vk: 9 },
    iso_left_tab: { key: "Tab", code: "Tab", vk: 9 },
    escape: { key: "Escape", code: "Escape", vk: 27 },
    delete: { key: "Delete", code: "Delete", vk: 46 },
    insert: { key: "Insert", code: "Insert", vk: 45 },
    home: { key: "Home", code: "Home", vk: 36 },
    end: { key: "End", code: "End", vk: 35 },
    prior: { key: "PageUp", code: "PageUp", vk: 33 },
    page_up: { key: "PageUp", code: "PageUp", vk: 33 },
    next: { key: "PageDown", code: "PageDown", vk: 34 },
    page_down: { key: "PageDown", code: "PageDown", vk: 34 },
    up: { key: "ArrowUp", code: "ArrowUp", vk: 38 },
    down: { key: "ArrowDown", code: "ArrowDown", vk: 40 },
    left: { key: "ArrowLeft", code: "ArrowLeft", vk: 37 },
    right: { key: "ArrowRight", code: "ArrowRight", vk: 39 },
    space: { key: " ", code: "Space", vk: 32, text: " " },
    minus: { key: "-", code: "Minus", vk: 189, text: "-", shifted: { key: "_", text: "_" } },
    underscore: { key: "_", code: "Minus", vk: 189, text: "_" },
    equal: { key: "=", code: "Equal", vk: 187, text: "=", shifted: { key: "+", text: "+" } },
    plus: { key: "+", code: "Equal", vk: 187, text: "+" },
    comma: { key: ",", code: "Comma", vk: 188, text: ",", shifted: { key: "<", text: "<" } },
    period: { key: ".", code: "Period", vk: 190, text: ".", shifted: { key: ">", text: ">" } },
    slash: { key: "/", code: "Slash", vk: 191, text: "/", shifted: { key: "?", text: "?" } },
    semicolon: { key: ";", code: "Semicolon", vk: 186, text: ";", shifted: { key: ":", text: ":" } },
    apostrophe: { key: "'", code: "Quote", vk: 222, text: "'", shifted: { key: '"', text: '"' } },
    bracketleft: { key: "[", code: "BracketLeft", vk: 219, text: "[", shifted: { key: "{", text: "{" } },
    bracketright: { key: "]", code: "BracketRight", vk: 221, text: "]", shifted: { key: "}", text: "}" } },
    backslash: { key: "\\", code: "Backslash", vk: 220, text: "\\", shifted: { key: "|", text: "|" } },
    grave: { key: "`", code: "Backquote", vk: 192, text: "`", shifted: { key: "~", text: "~" } },
};
for (let n = 1; n <= 12; n++) NAMED[`f${n}`] = { key: `F${n}`, code: `F${n}`, vk: 111 + n };

function base(name: string): Key | null {
    const lower = name.toLowerCase();
    if (NAMED[lower]) return NAMED[lower]!;
    if (/^[a-z]$/i.test(name)) {
        const l = lower;
        return { key: l, code: `Key${l.toUpperCase()}`, vk: l.toUpperCase().charCodeAt(0), text: l, shifted: { key: l.toUpperCase(), text: l.toUpperCase() } };
    }
    if (/^[0-9]$/.test(name)) return { key: name, code: `Digit${name}`, vk: name.charCodeAt(0), text: name };
    return null;
}

// on macOS the browser's editing shortcuts are commands, not keys; ctrl stands for cmd there, as the agent writes them
const MAC_COMMANDS: Record<string, string> = { a: "selectAll", c: "copy", v: "paste", x: "cut", z: "undo" };

/** One chord's key events (modifiers down, the key, modifiers up), or why the name isn't a key. */
export function chord(name: string, platform: NodeJS.Platform = process.platform): KeyEvent[] | string {
    if (!name || name.length > 64 || !/^[A-Za-z0-9_+]+$/.test(name)) return `"${name.slice(0, 64)}" isn't a key; keys look like ctrl+shift+t or Return`;
    const parts = name.split("+").filter(Boolean);
    const last = parts.pop();
    if (!last) return `"${name}" isn't a key`;
    let bits = 0;
    const held: (typeof MODS)[string][] = [];
    for (const p of parts) {
        const m = MOD_NAMES[p.toLowerCase()];
        if (!m) return `"${p}" isn't a modifier (ctrl, shift, alt, super)`;
        if (!(bits & MODS[m]!.bit)) held.push(MODS[m]!);
        bits |= MODS[m]!.bit;
    }
    const lone = MOD_NAMES[last.toLowerCase()];
    const k = lone ? { key: MODS[lone]!.key, code: MODS[lone]!.code, vk: MODS[lone]!.vk } : base(last);
    if (!k) return `"${last}" isn't a key name; try Return, Tab, Escape, BackSpace, Up, Down, Left, Right, Home, End, Prior, Next, F1–F12, a letter or a digit`;
    const shift = (bits & MODS.shift!.bit) !== 0;
    const key = shift && k.shifted ? k.shifted.key : k.key;
    // only an unmodified (or shifted) key types; ctrl+a selects, it doesn't type an a
    const text = bits & ~MODS.shift!.bit ? undefined : shift && k.shifted ? k.shifted.text : k.text;
    const events: KeyEvent[] = [];
    let down = 0;
    for (const m of held) {
        down |= m.bit;
        events.push({ type: "rawKeyDown", modifiers: down, key: m.key, code: m.code, windowsVirtualKeyCode: m.vk });
    }
    const press: KeyEvent = { type: text ? "keyDown" : "rawKeyDown", modifiers: bits, key, code: k.code, windowsVirtualKeyCode: k.vk };
    if (text) Object.assign(press, { text, unmodifiedText: text });
    const command = platform === "darwin" && bits === MODS.ctrl!.bit ? MAC_COMMANDS[k.key] : undefined;
    if (command) press.commands = [command];
    events.push(press, { type: "keyUp", modifiers: bits, key, code: k.code, windowsVirtualKeyCode: k.vk });
    for (const m of held.reverse()) {
        down &= ~m.bit;
        events.push({ type: "keyUp", modifiers: down, key: m.key, code: m.code, windowsVirtualKeyCode: m.vk });
    }
    return events;
}
