// The computer's tools as the agent sees them (MCP tool definitions). The
// service serves them; the guest agent inside the VM carries them out.

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
- Reach for \`shell\` first. Downloads, files, calculations, text, scripts and lookups are faster and more reliable there. Only open a window (\`open\`) when a task really needs one, like reading a web page that needs a browser or using a graphical app.
- With windows: \`look\` at it, act on a numbered mark (\`click\` with mark, then \`type\`/\`key\`), then \`look\` again to check what happened. Marks are only valid for the latest look.
- When something isn't marked, is tiny, or the text is too small to read (canvas, games, custom widgets), \`zoom\` into that region and click with the x/y its grid shows. \`hover\` opens hover menus; \`drag\` moves sliders and drags things.
- In the browser, ctrl+l focuses the address bar; typing a URL with enter=true goes there.
- You can search the web directly, too.
- Don't claim you did something you didn't verify.`;

export const COMPUTER_TOOLS: ToolSpec[] = [
    {
        name: "shell",
        description:
            "Run a bash command on your computer (Debian 13, user `agent`, with passwordless sudo) and get its output. " +
            "Prefer this over opening apps: files, downloads (curl), text processing, scripts and anything a CLI can do. " +
            "Default timeout 60 s, max 600.",
        inputSchema: {
            type: "object",
            properties: { command: { type: "string" }, timeout: { type: "integer", minimum: 1, maximum: 600 } },
            required: ["command"],
        },
    },
    {
        name: "windows",
        description: "List the open windows: id, title, app, position and size. There's no desktop; each window stands alone.",
        inputSchema: { type: "object", properties: {} },
    },
    {
        name: "open",
        description:
            "Open something that needs a window. A URL (or `browser`) opens the Helium web browser; anything else is run as a command line, e.g. `mousepad notes.txt` or `galculator`. " +
            "Returns the new window's id. Clicks and keys also report windows that open or close (dialogs, menus).",
        inputSchema: { type: "object", properties: { what: { type: "string" } }, required: ["what"] },
    },
    {
        name: "look",
        description:
            "Bring a window to the front and screenshot it. Things you can click, type into or scroll get numbered marks, listed with their kind and label. " +
            "Marks come from the app's accessibility tree, so apps that draw their own pixels (canvas, games) have few or none: zoom in and use x/y there. " +
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
        description: "Type text into the focused field of a window (click the field first). Set enter to press Enter afterwards.",
        inputSchema: {
            type: "object",
            properties: { window: win, text: { type: "string" }, enter: { type: "boolean" } },
            required: ["window", "text"],
        },
    },
    {
        name: "key",
        description: "Press keys in a window, xdotool names separated by spaces, e.g. `ctrl+l`, `Return`, `ctrl+s`, `Escape`, `Tab Tab Return`.",
        inputSchema: { type: "object", properties: { window: win, keys: { type: "string" } }, required: ["window", "keys"] },
    },
    {
        name: "scroll",
        description: "Scroll at a mark, x/y, or the window's middle. Positive amount scrolls down, negative up (about 3 lines per step).",
        inputSchema: { type: "object", properties: { window: win, ...where, amount: { type: "integer" } }, required: ["window"] },
    },
    {
        name: "place",
        description: "Move or resize a window (screen is 1280x800).",
        inputSchema: {
            type: "object",
            properties: { window: win, x: { type: "integer" }, y: { type: "integer" }, width: { type: "integer" }, height: { type: "integer" } },
            required: ["window"],
        },
    },
    {
        name: "close",
        description: "Close a window.",
        inputSchema: { type: "object", properties: { window: win }, required: ["window"] },
    },
];
