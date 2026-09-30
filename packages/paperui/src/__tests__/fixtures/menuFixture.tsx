// Real-browser menu fixture for menuInteractions.browser.test.ts.
//
// Mounts the published PaperUI components and drives browser-shaped pointer
// sequences: each step hit-tests with elementFromPoint and click lands on the
// nearest common ancestor of press and release, the way a browser delivers
// it. jsdom cannot catch this class of defect — it dispatches click on a
// display:none element, so the suite stayed green while a real option click
// did nothing.
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import {
    PaperAudio,
    PaperContextMenu,
    PaperContextMenuItem,
    PaperSelectMenu,
    PaperSelectMenuItem,
    PaperRange,
    useContextMenuState,
} from "../../index";
import "../../styles/styles.css";

interface FixtureResults {
    checks: Record<string, unknown>;
    error: string;
}

const out: FixtureResults = { checks: {}, error: "" };

function report(): void {
    const results = document.getElementById("results");
    if (results) results.textContent = `RESULT:${btoa(JSON.stringify(out))}`;
}

function menuIsShowing(selector: string): boolean {
    const el = document.querySelector(selector);
    return !!el && getComputedStyle(el).display !== "none";
}

function centerOf(el: Element): { x: number; y: number } {
    const rect = el.getBoundingClientRect();
    return {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
    };
}

function browserClick(x: number, y: number, afterPress?: () => void): void {
    const press = (node: Element | null, type: string, buttons: number) => {
        node?.dispatchEvent(
            new PointerEvent(type, {
                bubbles: true,
                cancelable: true,
                clientX: x,
                clientY: y,
                button: 0,
                buttons,
            }),
        );
    };
    const mouse = (node: Element | null, type: string, buttons: number) => {
        node?.dispatchEvent(
            new MouseEvent(type, {
                bubbles: true,
                cancelable: true,
                clientX: x,
                clientY: y,
                button: 0,
                buttons,
            }),
        );
    };

    const down = document.elementFromPoint(x, y);
    press(down, "pointerdown", 1);
    mouse(down, "mousedown", 1);

    afterPress?.();

    const up = document.elementFromPoint(x, y);
    press(up, "pointerup", 0);
    mouse(up, "mouseup", 0);

    let clickTarget: Element | null = down;
    while (clickTarget && up && !clickTarget.contains(up)) {
        clickTarget = clickTarget.parentElement;
    }
    mouse(clickTarget ?? up, "click", 0);
}

function Fixture() {
    const [selected, setSelected] = createSignal("alpha");
    const menu = useContextMenuState();
    let contextItemClicks = 0;

    return (
        <div style={{ padding: "24px" }}>
            <PaperSelectMenu
                name="fixture-select"
                value={selected()}
                onValueChange={(value) => {
                    out.checks.selectCommitted = String(value);
                    setSelected(String(value));
                }}
            >
                <PaperSelectMenuItem value="alpha">Alpha</PaperSelectMenuItem>
                <PaperSelectMenuItem value="beta">Beta</PaperSelectMenuItem>
            </PaperSelectMenu>

            <div
                id="context-target"
                style={{
                    width: "200px",
                    "margin-top": "32px",
                    padding: "12px",
                    border: "1px solid var(--paper-border)",
                }}
                onContextMenu={(e) => {
                    e.preventDefault();
                    menu.openAtMouse(e);
                }}
            >
                right click target
            </div>

            <PaperContextMenu
                open={menu.isOpen()}
                target={menu.target()}
                placement={menu.placement()}
                onClose={menu.close}
            >
                <PaperContextMenuItem
                    value="reload"
                    icon="refresh"
                    onClick={() => {
                        contextItemClicks += 1;
                        out.checks.contextItemClicks = contextItemClicks;
                    }}
                >
                    Reload Panel
                </PaperContextMenuItem>
            </PaperContextMenu>

            {/* Sizing only resolves with real layout: a vertical range in an
                auto-height box once collapsed to 0px (an empty volume box). */}
            <div id="range-auto" style={{ display: "flex", "margin-top": "160px" }}>
                <PaperRange aria-label="Auto height" orientation="vertical" value={50} />
            </div>
            <div style={{ "margin-top": "32px" }}>
                <PaperAudio src="data:audio/wav;base64," waveform={false} label="Fixture audio" />
            </div>
        </div>
    );
}

function run(): void {
    const trigger = document.querySelector(
        'button[aria-haspopup="listbox"]',
    ) as HTMLElement;
    const triggerPoint = centerOf(trigger);
    browserClick(triggerPoint.x, triggerPoint.y);
    out.checks.selectOpened = menuIsShowing('[role="listbox"]');

    const option = document.querySelector(
        '[data-select-value="beta"]',
    ) as HTMLElement;
    const optionPoint = centerOf(option);
    browserClick(optionPoint.x, optionPoint.y, () => {
        out.checks.popupOpenAfterOptionPress = menuIsShowing('[role="listbox"]');
    });
    out.checks.selectClosedAfterOption = !menuIsShowing('[role="listbox"]');
    out.checks.triggerLabel = trigger.textContent?.trim() ?? "";

    const target = document.getElementById("context-target") as HTMLElement;
    const targetPoint = centerOf(target);
    target.dispatchEvent(
        new PointerEvent("pointerdown", {
            bubbles: true,
            cancelable: true,
            clientX: targetPoint.x,
            clientY: targetPoint.y,
            button: 2,
            buttons: 2,
        }),
    );
    target.dispatchEvent(new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        clientX: targetPoint.x,
        clientY: targetPoint.y,
        button: 2,
        buttons: 2,
    }));
    target.dispatchEvent(
        new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            clientX: targetPoint.x,
            clientY: targetPoint.y,
            button: 2,
        }),
    );
    out.checks.contextMenuOpened = menuIsShowing('[role="menu"]');

    const item = document.querySelector(
        '[role="menu"] [data-context-item="reload"]',
    ) as HTMLElement;
    const itemPoint = centerOf(item);
    browserClick(itemPoint.x, itemPoint.y);
    out.checks.contextMenuClosedAfterItem = !menuIsShowing('[role="menu"]');

    const autoRange = document.querySelector('[role="slider"][aria-label="Auto height"]') as HTMLElement;
    out.checks.autoRangeTrackHeight = (autoRange.firstElementChild as HTMLElement).getBoundingClientRect().height;

    const volumeButton = document.querySelector(
        '[role="group"][aria-label="Fixture audio"] button[aria-label="Mute"]',
    ) as HTMLElement;
    volumeButton.dispatchEvent(new PointerEvent("pointerenter"));
    const volume = document.querySelector('[role="slider"][aria-label="Volume"]') as HTMLElement | null;
    out.checks.volumeTrackHeight = volume
        ? (volume.firstElementChild as HTMLElement).getBoundingClientRect().height
        : -1;
}

try {
    render(() => <Fixture />, document.getElementById("app") as HTMLElement);
    // Solid flushes synchronously; one task lets layout settle before hit tests
    setTimeout(() => {
        run();
        report();
    }, 0);
} catch (err) {
    out.error = err instanceof Error ? err.stack ?? err.message : String(err);
    report();
}
