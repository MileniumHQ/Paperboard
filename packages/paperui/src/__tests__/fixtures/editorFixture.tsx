// Real-browser fixture for editor.browser.test.ts.
//
// jsdom applies no CSS, loads no fonts and has no execCommand, so it cannot
// see the three things that make PaperEditor work: the textarea's text
// landing exactly on the highlighted rows beneath it, native undo surviving
// the editor's own key handling, and every icon ligature drawing as a glyph
// rather than as its name spelled out.
import { render } from "solid-js/web";
import {
    PaperEditor,
    PaperFileBrowser,
    PaperIcon,
    PAPER_FILE_BROWSER_ICONS,
    type PaperFileListing,
} from "../../index";
import "../../styles/styles.css";
import editorStyles from "../../components/PaperEditor/index.module.css";

interface FixtureResults {
    checks: Record<string, unknown>;
    error: string;
}

const out: FixtureResults = { checks: {}, error: "" };

function report(): void {
    const results = document.getElementById("results");
    if (results) results.textContent = `RESULT:${btoa(JSON.stringify(out))}`;
}

// headless Chrome under a virtual time budget never paints, so frames never
// come; a timer lets layout settle instead
const nextFrame = () => new Promise<void>((resolve) => setTimeout(resolve, 16));

const LONG = `motd: "${"a long message that keeps going ".repeat(12)}"`;
const YAML = `# EssentialsX\nroot:\n  child: 1\n\tbadly-tabbed: true\n${LONG}\nlast: end`;
const ICON_CONTROL = "zzqx_not_a_real_icon";

const listing = async (path: string): Promise<PaperFileListing> =>
    path === ""
        ? { entries: [{ name: "plugins", path: "plugins", kind: "folder" }, { name: "eula.txt", path: "eula.txt", kind: "file" }] }
        : { entries: [{ name: "config.yml", path: `${path}/config.yml`, kind: "file" }] };

function Fixture() {
    const icons = [...new Set(Object.values(PAPER_FILE_BROWSER_ICONS)), ICON_CONTROL];
    return (
        <div>
            <div id="icons">
                {icons.map((name) => (
                    <PaperIcon data-icon={name}>{name}</PaperIcon>
                ))}
            </div>
            <div id="nowrap" style={{ width: "420px", height: "200px", display: "flex" }}>
                <PaperEditor value={YAML} language="yaml" aria-label="No wrap" />
            </div>
            <div id="wrap" style={{ width: "420px", height: "400px", display: "flex" }}>
                <PaperEditor value={YAML} language="yaml" wrap aria-label="Wrap" />
            </div>
            <div id="short" style={{ width: "420px", height: "400px", display: "flex" }}>
                <PaperEditor value={"a: 1\nb: 2"} language="yaml" aria-label="Short file in a tall editor" />
            </div>
            <div id="browser" style={{ width: "900px", height: "300px", display: "flex" }}>
                <PaperFileBrowser rootLabel="Server" list={listing} read={async () => ({ kind: "text", text: "x" })} />
            </div>
        </div>
    );
}

function alignment(id: string) {
    const root = document.getElementById(id)!;
    const textarea = root.querySelector("textarea")!;
    const lines = [...root.querySelectorAll<HTMLElement>(`.${editorStyles.line}`)];
    const numbers = [...root.querySelectorAll<HTMLElement>(`.${editorStyles.number}`)];
    const longIndex = YAML.split("\n").findIndex((line) => line === LONG);
    const longLine = lines[longIndex]!;
    const after = longIndex + 1;
    return {
        rows: lines.length,
        // the textarea never holds more text than the rows show: no hidden
        // overflow in either direction
        textareaFitsHeight: textarea.scrollHeight <= textarea.clientHeight + 1,
        textareaFitsWidth: textarea.scrollWidth <= textarea.clientWidth + 1,
        // the widest row and the textarea agree on the long line's width
        longLineWidth: Math.round(longLine.scrollWidth),
        textareaWidth: Math.round(textarea.clientWidth),
        longLineHeight: Math.round(longLine.getBoundingClientRect().height),
        lineHeight: Math.round(lines[0]!.getBoundingClientRect().height),
        // the number after a wrapped line still sits beside its own line
        numberAfterLongTop: Math.round(numbers[after]!.getBoundingClientRect().top),
        lineAfterLongTop: Math.round(lines[after]!.getBoundingClientRect().top),
        highlightedKeys: root.querySelectorAll(".token.atrule, .token.key").length,
        textareaColor: getComputedStyle(textarea).color,
    };
}

async function run(): Promise<void> {
    out.checks.stage = "fonts";
    report();
    await document.fonts.load('24px "Material Symbols Rounded"', "home");
    await document.fonts.load('16px "SUSE Mono"', "a");
    await document.fonts.ready;
    out.checks.stage = "frame";
    report();
    await nextFrame();
    out.checks.stage = "measure";
    report();

    // a ligature that exists draws one glyph about 1em wide; a missing one
    // spells its name in the icon font's letters
    const iconWidths: Record<string, number> = {};
    for (const el of document.querySelectorAll<HTMLElement>("#icons [data-icon]")) {
        const size = parseFloat(getComputedStyle(el).fontSize);
        iconWidths[el.dataset.icon!] = Math.round((el.getBoundingClientRect().width / size) * 100) / 100;
    }
    out.checks.iconWidthsInEm = iconWidths;
    out.checks.iconControl = ICON_CONTROL;

    out.checks.nowrap = alignment("nowrap");
    out.checks.wrap = alignment("wrap");

    // a short file in a tall editor: rows keep one line's height, and the
    // textarea still fills the editor so a click below the text lands in it
    const short = document.getElementById("short")!;
    const shortLines = [...short.querySelectorAll<HTMLElement>(`.${editorStyles.line}`)];
    out.checks.short = {
        rowHeights: shortLines.map((el) => Math.round(el.getBoundingClientRect().height)),
        lineHeight: Math.round(parseFloat(getComputedStyle(shortLines[0]!).lineHeight)),
        textareaHeight: Math.round(short.querySelector("textarea")!.getBoundingClientRect().height),
    };

    // Tab indents through a native edit, so the browser's undo restores it
    const textarea = document.querySelector<HTMLTextAreaElement>("#nowrap textarea")!;
    textarea.focus();
    textarea.setSelectionRange(0, 0);
    const before = textarea.value;
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    textarea.dispatchEvent(tab);
    out.checks.tabPrevented = tab.defaultPrevented;
    out.checks.afterTabStart = textarea.value.slice(0, 4);
    document.execCommand("undo");
    out.checks.undoRestored = textarea.value === before;

    // Enter after "root:" opens a nested level using the file's own indent
    const rootEnd = textarea.value.indexOf("root:") + "root:".length;
    textarea.setSelectionRange(rootEnd, rootEnd);
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    out.checks.enterInserted = JSON.stringify(textarea.value.slice(rootEnd, rootEnd + 3));
    document.execCommand("undo");

    // focus stays on a folder row when that folder expands (rows are not rebuilt)
    await nextFrame();
    const folder = document.querySelector<HTMLElement>('#browser [role="treeitem"][data-path="plugins"]')!;
    folder.focus();
    folder.closest('[role="tree"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    for (let i = 0; i < 5; i++) await nextFrame();
    out.checks.childShown = !!document.querySelector('#browser [data-path="plugins/config.yml"]');
    out.checks.focusKept = document.activeElement === folder && folder.isConnected;
    out.checks.stage = "done";
}

try {
    render(() => <Fixture />, document.getElementById("app") as HTMLElement);
    run()
        .catch((err) => {
            out.error = err instanceof Error ? err.stack ?? err.message : String(err);
        })
        .finally(report);
} catch (err) {
    out.error = err instanceof Error ? err.stack ?? err.message : String(err);
    report();
}
