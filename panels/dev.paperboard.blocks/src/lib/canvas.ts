// The editor's canvas: Blockly drawn into the page with Paper's renderer,
// theme and Library, PaperUI's trash over it, the results tray, culling and
// native tooltips. It is laid out again as its box changes size, and drawn
// again in the app's theme as the app switches.
import * as Blockly from "blockly";
import { paperContextMenus } from "./contextMenu";
import { cullOffscreenStacks } from "./culling";
import { paperDropdowns } from "./dropdownPlacement";
import { LIBRARY_FLYOUT, uiGap, type LibraryFlyout } from "./libraryFlyout";
import { nativeTooltips } from "./nativeTooltips";
import { PAPER_RENDERER, paperTheme } from "./paperRenderer";
import { addResultsTray } from "./results";
import { tokenPixels } from "./tokens";
import { addTrash, type TrashState } from "./trashZone";

export interface Canvas {
    workspace: Blockly.WorkspaceSvg;
    dispose(): void;
}

export function createCanvas(
    host: HTMLElement,
    options: {
        /** PaperUI's trash tile, which a block is dropped on to delete it */
        trash: HTMLElement;
        onTrash: (state: TrashState) => void;
        /** the class the results tray's own svg is laid out with */
        resultsTrayClass: string;
        /** every change Blockly reports on the canvas */
        onChange: (event: Blockly.Events.Abstract) => void;
        onThemeFailed: (err: unknown) => void;
    },
): Canvas {
    paperContextMenus();
    paperDropdowns();
    const workspace = Blockly.inject(host, {
        renderer: PAPER_RENDERER,
        theme: paperTheme(),
        toolbox: { kind: "flyoutToolbox", contents: [] },
        plugins: { flyoutsVerticalToolbox: LIBRARY_FLYOUT },
        media: "./blockly-media/",
        // the trash and zoom are PaperUI's, over the canvas
        trashcan: false,
        zoom: { controls: false, wheel: true, startScale: 1 },
        // the canvas's dots: one at every double gap, drawn by Editor.module.css
        grid: { spacing: tokenPixels("--paper-uigap") * 2, length: 1, colour: "transparent", snap: false },
        move: { scrollbars: true, drag: true, wheel: false },
        // the app makes no sounds; neither do its blocks
        sounds: false,
    });
    const offTooltips = nativeTooltips(host);
    const offCulling = cullOffscreenStacks(workspace);
    addTrash(workspace, options.trash, options.onTrash);
    addResultsTray(workspace, options.resultsTrayClass, uiGap());

    // The canvas is laid out again when its size changes, but not under a
    // block being dragged: Blockly would scroll to fit the block where it
    // was picked up, and it would leave the pointer. That waits for the drop.
    let fitWaiting = false;
    const fit = () => {
        fitWaiting = workspace.isDragging();
        if (!fitWaiting) Blockly.svgResize(workspace);
    };
    const resize = new ResizeObserver(fit);
    resize.observe(host);
    workspace.addChangeListener((event: Blockly.Events.Abstract) => {
        if (fitWaiting) fit();
        options.onChange(event);
    });

    // Light or dark, as the app switches: Blockly takes colours, not variables, so the theme is made again
    const retheme = () => {
        try {
            workspace.setTheme(paperTheme());
            // a collapsed Library stays hidden
            (workspace.getFlyout() as LibraryFlyout | null)?.redisplay();
        } catch (err) {
            options.onThemeFailed(err);
        }
    };
    const themeChanges = new MutationObserver(retheme);
    themeChanges.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-paperui-theme", "class"] });
    const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
    darkQuery.addEventListener("change", retheme);

    return {
        workspace,
        dispose() {
            themeChanges.disconnect();
            darkQuery.removeEventListener("change", retheme);
            resize.disconnect();
            offTooltips();
            offCulling();
            workspace.dispose();
        },
    };
}
