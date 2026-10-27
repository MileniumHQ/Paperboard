// The computer's tools as the agent sees them (MCP tool definitions). The
// service serves them and carries them out in its browser (browser.ts).

export interface ToolSpec {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}

const win = { type: "integer", description: "Window id from `windows`." };
const where = {
    mark: { type: "integer", description: "A numbered mark from the last `look` at this window." },
    x: { type: "integer", description: "Pixels from the window's left edge (use when nothing is marked)." },
    y: { type: "integer", description: "Pixels from the window's top edge." },
};

/** The computer's part of the agent's instructions. */
export const COMPUTER_INSTRUCTIONS = `How to use your computer:
- Your computer is a web browser (Helium); each window is a tab. \`open\` a web address, \`go\` to another one (or back, forward, reload) in the same window.
- \`look\` at a window, act on a numbered mark (\`click\` with mark, then \`type\`/\`key\`), then \`look\` again to check what happened. Marks are only valid for the latest look.
- When something isn't marked, is tiny, or the text is too small to read (canvas, games, custom widgets), \`zoom\` into that region and click with the x/y its grid shows. \`hover\` opens hover menus; \`drag\` moves sliders and drags things.
- What the browser downloads goes to ~/Downloads in your home folder; \`files\` lists it. To upload, click the page's upload button, then \`upload\` files from your home folder.
- It can't reach this computer or its local network, only the internet. You can search the web directly, too.
- Don't claim you did something you didn't verify.`;

export const COMPUTER_TOOLS: ToolSpec[] = [
    {
        name: "windows",
        description: "List the browser's open windows (tabs): id, title, address and size.",
        inputSchema: { type: "object", properties: {} },
    },
    {
        name: "open",
        description:
            "Open a web address in a new window, e.g. `https://example.com` or `example.com`; `browser` opens a blank one. " +
            "Returns the new window's id. Clicks and keys also report windows that open or close, downloads, and dialogs.",
        inputSchema: { type: "object", properties: { what: { type: "string" } }, required: ["what"] },
    },
    {
        name: "go",
        description: "Go somewhere in a window: a web address, or `back`, `forward` or `reload`.",
        inputSchema: { type: "object", properties: { window: win, to: { type: "string" } }, required: ["window", "to"] },
    },
    {
        name: "look",
        description:
            "Screenshot a window. Things you can click, type into or scroll get numbered marks, listed with their kind and label. " +
            "Pages that draw their own pixels (canvas, games) have few or none: zoom in and use x/y there. " +
            "Look again after anything changes: marks are only valid for the latest look.",
        inputSchema: { type: "object", properties: { window: win }, required: ["window"] },
    },
    {
        name: "zoom",
        description:
            "Screenshot part of a window enlarged (up to 6x), with grid lines labelled in window coordinates and the latest marks drawn in. " +
            "Use it to read small text or to find exact x/y for something unmarked or tiny, then click with those coordinates.",
        inputSchema: {
            type: "object",
            properties: {
                window: win,
                x: { type: "integer", description: "Left edge of the region, in window pixels." },
                y: { type: "integer", description: "Top edge of the region." },
                width: { type: "integer" },
                height: { type: "integer" },
            },
            required: ["window", "x", "y", "width", "height"],
        },
    },
    {
        name: "click",
        description: "Click a mark (preferred) or x/y in a window. Set double for a double click, button for right/middle.",
        inputSchema: {
            type: "object",
            properties: { window: win, ...where, button: { type: "string", enum: ["left", "middle", "right"] }, double: { type: "boolean" } },
            required: ["window"],
        },
    },
    {
        name: "hover",
        description: "Rest the pointer on a mark or x/y without clicking, for menus and tooltips that open on hover.",
        inputSchema: { type: "object", properties: { window: win, ...where }, required: ["window"] },
    },
    {
        name: "drag",
        description: "Press on a mark or x/y, move to to_mark or to_x/to_y, and release: sliders, drag and drop, selecting text.",
        inputSchema: {
            type: "object",
            properties: {
                window: win,
                ...where,
                to_mark: { type: "integer" },
                to_x: { type: "integer" },
                to_y: { type: "integer" },
            },
            required: ["window"],
        },
    },
    {
        name: "type",
        description: "Type text into the focused field of a window (click the field first). Set enter to press Enter afterwards. Answers a prompt dialog, too.",
        inputSchema: {
            type: "object",
            properties: { window: win, text: { type: "string" }, enter: { type: "boolean" } },
            required: ["window", "text"],
        },
    },
    {
        name: "key",
        description:
            "Press keys in a window, xdotool names separated by spaces, e.g. `Return`, `Tab Tab Return`, `ctrl+a`, `Escape`. " +
            "When the page shows a dialog, Return accepts it and Escape dismisses it.",
        inputSchema: { type: "object", properties: { window: win, keys: { type: "string" } }, required: ["window", "keys"] },
    },
    {
        name: "scroll",
        description: "Scroll at a mark, x/y, or the window's middle. Positive amount scrolls down, negative up (about 3 lines per step).",
        inputSchema: { type: "object", properties: { window: win, ...where, amount: { type: "integer" } }, required: ["window"] },
    },
    {
        name: "place",
        description: "Resize a window's page, e.g. narrower to see a site's phone layout (default 1272x730).",
        inputSchema: {
            type: "object",
            properties: { window: win, width: { type: "integer" }, height: { type: "integer" } },
            required: ["window"],
        },
    },
    {
        name: "close",
        description: "Close a window.",
        inputSchema: { type: "object", properties: { window: win }, required: ["window"] },
    },
    {
        name: "upload",
        description: "Pick files from your home folder for the file picker a page just opened (click its upload button first), e.g. `~/Downloads/photo.png`.",
        inputSchema: {
            type: "object",
            properties: { window: win, files: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 10 } },
            required: ["window", "files"],
        },
    },
    {
        name: "files",
        description: "List a folder in your home folder: downloads go to ~/Downloads, files you're given go where they're put.",
        inputSchema: { type: "object", properties: { folder: { type: "string", description: "Defaults to ~." } } },
    },
];
