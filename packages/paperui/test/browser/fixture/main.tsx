// The page the Chrome suites drive. It mounts the published PaperUI build
// (the alias in support/globalSetup.ts points at dist/) with its bundled
// stylesheet, one scenario per page load: `?s=<scenario>`. A scenario puts
// what the test needs to read or drive on `window.t`.
import "@mileniumhq/paperui/style.css";
import { createSignal, For, Show, type JSX } from "solid-js";
import { render } from "solid-js/web";
import {
    PaperAudio,
    PaperBadge,
    PaperButton,
    PaperConsole,
    PaperContextMenu,
    PaperContextMenuHeader,
    PaperContextMenuItem,
    PaperContextMenuSub,
    PaperFileBrowser,
    PaperInput,
    PaperInterfaceGroup,
    PaperInterfaceItem,
    PaperList,
    PaperListItem,
    PaperMarkdown,
    PaperMenu,
    PaperMenuItem,
    PaperModal,
    PaperPanel,
    PaperProvider,
    PaperRail,
    PaperRailItem,
    PaperSelectMenu,
    PaperSelectMenuItem,
    PaperSlidePage,
    PaperSplit,
    PaperToggle,
    createPaperCompact,
    createPolling,
    setHapticPlayer,
    useContextMenuState,
    type PaperFileBrowserRef,
    type ThemeMode,
} from "@mileniumhq/paperui";

declare global {
    interface Window {
        fixtureReady?: boolean;
        fixtureError?: string;
        t: Record<string, any>;
    }
}

const query = new URLSearchParams(location.search);
window.t = {};

// light unless the page asks for ?theme=dark; the content is built inside
// the provider, as a page's own JSX children are, so it sees the provider
const shell = (content: () => JSX.Element) => (
    <PaperProvider fullScreen theme={query.get("theme") === "dark" ? "dark" : "light"}>
        {content()}
    </PaperProvider>
);

const lines = (from: number, count: number) => Array.from({ length: count }, (_, i) => `line ${from + i}`);

const scenarios: Record<string, () => JSX.Element> = {
    compact() {
        return shell(() => {
            const compact = createPaperCompact();
            return <span id="compact">{compact() ? "phone" : "wide"}</span>;
        });
    },
    modalLeave() {
        const [open, setOpen] = createSignal(true);
        const t = (window.t = { presses: 0, close: () => setOpen(false) });
        return shell(() => (
            <>
                <button
                    id="under"
                    type="button"
                    style={{ position: "fixed", inset: "0", width: "100vw", height: "100vh" }}
                    onClick={() => t.presses++}
                >
                    under
                </button>
                <PaperModal open={open()} onClose={() => setOpen(false)} title="Leaving">
                    <p id="modal-body">The page under this dialog takes presses once it closes.</p>
                </PaperModal>
            </>
        ));
    },

    railReorder() {
        const [order, setOrder] = createSignal(["home", "games", "files"]);
        const [value, setValue] = createSignal("home");
        const t = (window.t = { reorders: [] as string[][], order, value });
        return shell(() => (
            <div style={{ padding: "24px", height: "400px", display: "flex" }}>
                <PaperRail
                    name="rail"
                    value={value()}
                    onValueChange={(v) => setValue(String(v))}
                    onReorder={(next) => {
                        t.reorders.push(next);
                        setOrder(next);
                    }}
                >
                    <For each={order()}>
                        {(item) => <PaperRailItem value={item} icon="home" label={item} reorderable data-item={item} />}
                    </For>
                </PaperRail>
            </div>
        ));
    },

    listReorder() {
        const [order, setOrder] = createSignal(["alpha", "beta", "gamma"]);
        const [value, setValue] = createSignal("alpha");
        const t = (window.t = { reorders: [] as string[][], listClicks: 0, itemClicks: [] as string[], value });
        return shell(() => (
            <div style={{ padding: "24px", width: "320px" }}>
                <PaperList
                    name="list"
                    value={value()}
                    onValueChange={(v) => setValue(String(v))}
                    reorderable
                    onReorder={(next) => {
                        t.reorders.push(next as string[]);
                        setOrder(next as string[]);
                    }}
                    onClick={() => t.listClicks++}
                >
                    <For each={order()}>
                        {(item) => (
                            <PaperListItem value={item} data-item={item} onClick={() => t.itemClicks.push(item)}>
                                {item}
                            </PaperListItem>
                        )}
                    </For>
                </PaperList>
            </div>
        ));
    },

    modalFocus() {
        const [open, setOpen] = createSignal(false);
        window.t = { isOpen: () => open() };
        return shell(() => (
            <div style={{ padding: "24px" }}>
                <PaperButton id="opener" onClick={() => setOpen(true)}>
                    Rename
                </PaperButton>
                <PaperModal open={open()} onClose={() => setOpen(false)} title="Rename">
                    <input id="name" aria-label="Name" autofocus />
                </PaperModal>
            </div>
        ));
    },

    selectMenu() {
        const [size, setSize] = createSignal("s");
        const [added, setAdded] = createSignal(false);
        const [label, setLabel] = createSignal("Ex");
        const [plan, setPlan] = createSignal("free");
        const t = (window.t = {
            changes: [] as unknown[],
            setPlan,
            formEvents: [] as string[],
            controlledChanges: [] as unknown[],
            setSize,
            addOption: () => setAdded(true),
            relabel: setLabel,
        });
        const record = (e: Event) => {
            const input = e.target as HTMLInputElement;
            t.formEvents.push(`${e.type}:${input.name}=${input.value}`);
        };
        return shell(() => (
            <div style={{ display: "flex", "flex-direction": "column", gap: "24px", padding: "24px", width: "320px" }}>
                <form
                    id="free"
                    ref={(form) => {
                        form.addEventListener("input", record);
                        form.addEventListener("change", record);
                    }}
                >
                    <PaperSelectMenu name="fruit" placeholder="Fruit" onValueChange={(v) => t.changes.push(v)}>
                        <PaperSelectMenuItem value="apple">Apple</PaperSelectMenuItem>
                        <PaperSelectMenuItem value="banana">Banana</PaperSelectMenuItem>
                        <PaperSelectMenuItem value="cherry">Cherry</PaperSelectMenuItem>
                    </PaperSelectMenu>
                </form>
                <div id="controlled">
                    <PaperSelectMenu name="size" value={size()} onValueChange={(v) => t.controlledChanges.push(v)}>
                        <PaperSelectMenuItem value="s">Small</PaperSelectMenuItem>
                        <PaperSelectMenuItem value="m">Medium</PaperSelectMenuItem>
                        <PaperSelectMenuItem value="l">Large</PaperSelectMenuItem>
                    </PaperSelectMenu>
                </div>
                <div id="late">
                    <PaperSelectMenu name="late" value="x">
                        <PaperSelectMenuItem value="w">Double-u</PaperSelectMenuItem>
                        <Show when={added()}>
                            <PaperSelectMenuItem value="x">{label()}</PaperSelectMenuItem>
                        </Show>
                    </PaperSelectMenu>
                </div>
                <div id="searchable">
                    <PaperSelectMenu name="model" searchable onValueChange={(v) => t.changes.push(v)}>
                        <PaperSelectMenuItem value="fast">Fast</PaperSelectMenuItem>
                        <PaperSelectMenuItem value="smart">Smart</PaperSelectMenuItem>
                    </PaperSelectMenu>
                </div>
                <div id="searchControlled">
                    <PaperSelectMenu name="plan" searchable value={plan()} onValueChange={(v) => setPlan(String(v))}>
                        <PaperSelectMenuItem value="free">Free</PaperSelectMenuItem>
                        <PaperSelectMenuItem value="pro">Pro</PaperSelectMenuItem>
                        <PaperSelectMenuItem value="team">Team</PaperSelectMenuItem>
                    </PaperSelectMenu>
                </div>
                <div id="scroller" style={{ height: "160px", overflow: "auto" }}>
                    <div style={{ height: "800px" }}>scrolls</div>
                </div>
            </div>
        ));
    },

    contextMenu() {
        const menu = useContextMenuState();
        const t = (window.t = { runs: [] as string[], closes: 0 });
        return shell(() => (
            <>
                <div
                    id="target"
                    style={{ position: "fixed", left: "40px", top: "40px", width: "400px", height: "300px", background: "lightgray" }}
                    onContextMenu={(e) => menu.openAtMouse(e)}
                >
                    right-click here
                </div>
                <div id="scroller" style={{ position: "fixed", left: "700px", top: "40px", width: "200px", height: "120px", overflow: "auto" }}>
                    <div style={{ height: "2000px" }}>tall</div>
                </div>
                <PaperContextMenu
                    open={menu.isOpen()}
                    target={menu.target()}
                    placement={menu.placement()}
                    onClose={() => {
                        t.closes++;
                        menu.close();
                    }}
                >
                    <PaperContextMenuItem onClick={() => t.runs.push("Rename")}>Rename</PaperContextMenuItem>
                    <PaperContextMenuSub label="Move to">
                        <PaperContextMenuHeader>Destinations</PaperContextMenuHeader>
                        <PaperContextMenuItem onClick={() => t.runs.push("Folder A")}>Folder A</PaperContextMenuItem>
                        <PaperContextMenuItem onClick={() => t.runs.push("Folder B")}>Folder B</PaperContextMenuItem>
                    </PaperContextMenuSub>
                    <PaperContextMenuItem onClick={() => t.runs.push("Delete")}>Delete</PaperContextMenuItem>
                </PaperContextMenu>
            </>
        ));
    },

    markdownAnchors() {
        window.t = {};
        const filler = lines(1, 40).join("\n\n");
        const first = [
            "[Details](#details) [Second details](#details-1) [Café](#caf%C3%A9)",
            filler,
            "## Details",
            filler,
            "## Details",
            filler,
            "## Café",
            filler,
        ].join("\n\n");
        const second = ["[Details](#details)", filler, "## Details", filler].join("\n\n");
        return shell(() => (
            <>
                <p id="details">the page's own element, which a link must not reach</p>
                <div id="scroller" style={{ height: "300px", overflow: "auto" }}>
                    <div id="first">
                        <PaperMarkdown text={first} />
                    </div>
                    <div id="second">
                        <PaperMarkdown text={second} />
                    </div>
                </div>
            </>
        ));
    },

    input() {
        const [stored, setStored] = createSignal("Survival");
        const [slow, setSlow] = createSignal("Survival");
        const [code, setCode] = createSignal("");
        const t = (window.t = {
            saved: [] as string[],
            slowSaved: [] as string[],
            /** what the slow field showed while its save was under way */
            slowSeen: [] as string[],
            refused: [] as string[],
            stored,
            slow,
            code,
        });
        return shell(() => (
            <div style={{ display: "flex", "flex-direction": "column", gap: "24px", padding: "24px", width: "320px" }}>
                {/* saves on blur from the field itself, with no draft of its own */}
                <PaperInput
                    id="on-blur"
                    label="Server name"
                    value={stored()}
                    onBlur={(e) => {
                        t.saved.push(e.currentTarget.value);
                        setStored(e.currentTarget.value);
                    }}
                />
                {/* the same, answering once a save that takes a while is done */}
                <PaperInput
                    id="slow"
                    label="Slow"
                    value={slow()}
                    onBlur={(e) => {
                        const field = e.currentTarget;
                        const next = field.value;
                        return new Promise<void>((resolve) => {
                            const watch = setInterval(() => t.slowSeen.push(field.value), 5);
                            setTimeout(() => {
                                clearInterval(watch);
                                t.slowSaved.push(next);
                                setSlow(next);
                                resolve();
                            }, 120);
                        });
                    }}
                />
                {/* reshapes every keystroke: capitals, no digits */}
                <PaperInput
                    id="sanitised"
                    label="Code"
                    value={code()}
                    onInput={(e) => setCode(e.currentTarget.value.toUpperCase().replace(/[0-9]/g, ""))}
                />
                {/* keeps its value whatever is typed */}
                <PaperInput id="refused" label="Fixed" value="fixed" onChange={(e) => t.refused.push(e.currentTarget.value)} />
                <button id="elsewhere" type="button">
                    elsewhere
                </button>
            </div>
        ));
    },

    toggle() {
        const [on, setOn] = createSignal(false);
        const [refusing, setRefusing] = createSignal(false);
        const [saved, setSaved] = createSignal(false);
        let save: ((keep: boolean) => void) | undefined;
        const t = (window.t = {
            changes: [] as boolean[],
            controlledChanges: [] as boolean[],
            disabledChanges: [] as boolean[],
            haptics: [] as string[],
            setControlled: setOn,
            setRefusing,
            setSaved,
            /** the pending save answers: kept (the state changes) or refused */
            answerSave: async (keep: boolean) => {
                save?.(keep);
                save = undefined;
                // let the toggle hear the save settle
                await Promise.resolve();
                await Promise.resolve();
            },
        });
        setHapticPlayer((kind) => {
            t.haptics.push(kind);
            return true;
        });
        const row = { display: "flex", gap: "12px", "align-items": "center", padding: "12px" } as const;
        return shell(() => (
            <div style={{ padding: "24px" }}>
                <label id="free" style={row}>
                    <PaperToggle name="notify" onChange={(v) => t.changes.push(v)} />
                    <span id="free-text">Notifications</span>
                </label>
                <label id="controlled" style={row}>
                    <PaperToggle
                        checked={on()}
                        onChange={(v) => {
                            t.controlledChanges.push(v);
                            setOn(v);
                        }}
                    />
                    <span id="controlled-text">Controlled</span>
                </label>
                <label id="refusing" style={row}>
                    {/* its parent never takes the flip */}
                    <PaperToggle checked={refusing()} onChange={() => {}} />
                    <span id="refusing-text">Refusing</span>
                </label>
                <label id="saving" style={row}>
                    {/* changes only once its save answers */}
                    <PaperToggle
                        checked={saved()}
                        onChange={(v) =>
                            new Promise<void>((resolve) => {
                                save = (keep) => {
                                    if (keep) setSaved(v);
                                    resolve();
                                };
                            })
                        }
                    />
                    <span id="saving-text">Saving</span>
                </label>
                <label id="disabled" style={row}>
                    <PaperToggle disabled onChange={(v) => t.disabledChanges.push(v)} />
                    <span id="disabled-text">Disabled</span>
                </label>
            </div>
        ));
    },

    listSplit() {
        const [width, setWidth] = createSignal(400);
        const [open, setOpen] = createSignal<string | undefined>();
        const [compact, setCompact] = createSignal(false);
        const [names, setNames] = createSignal(["Alex", "Sam", "Kai"]);
        const t = (window.t = { collapsed: [] as boolean[], closes: 0, opens: [] as string[], setWidth, setNames });
        return shell(() => (
            <div id="split" style={{ width: `${width()}px`, height: "600px" }}>
                <PaperSplit
                    detailActive={open() !== undefined}
                    onDetailClose={() => {
                        t.closes++;
                        setOpen(undefined);
                    }}
                    detailTitle={open()}
                    onCollapsedChange={(c) => {
                        t.collapsed.push(c);
                        setCompact(c);
                    }}
                    side={
                        <PaperList name="players" value={open()} onValueChange={(v) => setOpen(String(v))}>
                            <For each={names()}>
                                {(name) => (
                                    <PaperListItem
                                        value={name}
                                        onClick={(e) => {
                                            // the roster's pattern: collapsed, a row opens the detail directly
                                            if (compact()) e.preventDefault();
                                            t.opens.push(name);
                                            setOpen(name);
                                        }}
                                    >
                                        {name}
                                    </PaperListItem>
                                )}
                            </For>
                        </PaperList>
                    }
                >
                    <p id="detail">{open() ?? "nobody"}</p>
                </PaperSplit>
            </div>
        ));
    },

    listOverflow() {
        const long = "SuperLongPluginNameForTestingOverflowBehaviour";
        const rows = (compact: boolean) => (
            <PaperList id={compact ? "compact" : "regular"} selectable={false} compact={compact} fullWidth>
                <PaperListItem
                    value="long"
                    icon="extension"
                    description={`${long}.jar · v1.0.0`}
                    actions={
                        <>
                            <PaperBadge variant="primary">OP</PaperBadge>
                            <PaperBadge variant="danger">Banned</PaperBadge>
                        </>
                    }
                >
                    {long}
                </PaperListItem>
            </PaperList>
        );
        return shell(() => (
            <div style={{ width: "400px" }}>
                {rows(false)}
                {rows(true)}
            </div>
        ));
    },

    fileBrowser() {
        // a.txt on a disk the test can change, and a host that asks the
        // browser before it would take it away
        const disk: Record<string, string> = { "a.txt": "alpha\n" };
        const versions: Record<string, number> = { "a.txt": 1 };
        let browser!: PaperFileBrowserRef;
        const t = (window.t = {
            disk,
            writes: 0,
            answers: [] as boolean[],
            dirty: () => browser.dirty(),
            /** a host leaving: records what the browser answered */
            leave: () => browser.confirmLeave().then((go) => t.answers.push(go)),
            changeOnDisk(text: string) {
                disk["a.txt"] = text;
                versions["a.txt"]++;
            },
        });
        return shell(() => (
            <div style={{ width: "100vw", height: "100vh", display: "flex" }}>
                <PaperFileBrowser
                    rootLabel="Root"
                    list={async () => ({ entries: [{ name: "a.txt", path: "a.txt", kind: "file" }] })}
                    read={async (path) => ({ kind: "text", text: disk[path]!, version: String(versions[path]) })}
                    write={async (path, text, version) => {
                        if (version !== String(versions[path])) throw new Error(`${path} changed on disk since it was opened`);
                        t.writes++;
                        disk[path] = text;
                        return { version: String(++versions[path]!) };
                    }}
                    ref={(handle) => (browser = handle)}
                />
            </div>
        ));
    },

    panel() {
        const [page, setPage] = createSignal("home");
        const [modal, setModal] = createSignal(false);
        window.t = {
            openModal: () => setModal(true),
            modalOpen: () => modal(),
            /** a host's system Back: true when PaperUI handled it */
            back() {
                const event = new Event("paperboard:back", { cancelable: true });
                window.dispatchEvent(event);
                return event.defaultPrevented;
            },
        };
        return shell(() => (
            <>
                <PaperPanel>
                    <PaperMenu name="nav" value={page()} onValueChange={(v) => setPage(String(v))}>
                        <PaperMenuItem value="home" icon="home">
                            Home
                        </PaperMenuItem>
                        <PaperMenuItem value="settings" icon="settings">
                            Settings
                        </PaperMenuItem>
                    </PaperMenu>
                    <PaperInterfaceGroup value={page()}>
                        <PaperInterfaceItem value="home">
                            <p id="home-page">Home page</p>
                        </PaperInterfaceItem>
                        <PaperInterfaceItem value="settings">
                            <p id="settings-page">Settings page</p>
                        </PaperInterfaceItem>
                    </PaperInterfaceGroup>
                </PaperPanel>
                <PaperModal open={modal()} onClose={() => setModal(false)} title="Over the page">
                    <p>modal</p>
                </PaperModal>
            </>
        ));
    },

    slidePage() {
        const [open, setOpen] = createSignal(true);
        const t = (window.t = { backs: 0, open: () => setOpen(true), isOpen: () => open() });
        return shell(() => (
            <div style={{ position: "relative", width: "100vw", height: "100vh", overflow: "hidden" }}>
                <PaperSlidePage
                    enabled
                    open={open()}
                    title="Detail"
                    onBack={() => {
                        t.backs++;
                        setOpen(false);
                    }}
                >
                    <div id="slide-content" style={{ height: "600px" }}>
                        content
                    </div>
                </PaperSlidePage>
            </div>
        ));
    },

    console() {
        const [entries, setEntries] = createSignal<string[]>(lines(0, Number(query.get("lines") ?? "0")));
        const t = (window.t = {
            flickerMeasures: 0,
            commands: [] as string[],
            append(count: number) {
                const current = entries();
                setEntries([...current, ...lines(current.length, count)]);
            },
            set: setEntries,
        });
        if (query.has("flicker")) {
            // A row whose measured height wobbles by a fraction of a pixel
            // every time it is measured, as subpixel layout makes a row do
            // when it moves. The console must settle on it, not re-measure
            // until the stack overflows.
            const measure = Element.prototype.getBoundingClientRect;
            Element.prototype.getBoundingClientRect = function (this: Element) {
                const rect = measure.call(this);
                if (this.textContent === "flicker" && this.parentElement?.style.transform.startsWith("translateY")) {
                    t.flickerMeasures++;
                    return new DOMRect(rect.x, rect.y, rect.width, rect.height + (t.flickerMeasures % 2 ? 0.3 : 0));
                }
                return rect;
            };
        }
        return shell(() => (
            <div id="console" style={{ width: "600px", height: "400px", display: "flex", "flex-direction": "column" }}>
                <PaperConsole
                    entries={entries()}
                    showInput={query.has("input")}
                    onCommand={(command) => t.commands.push(command)}
                    style={{ flex: "1", "min-height": "0" }}
                />
            </div>
        ));
    },

    audio() {
        const t = (window.t = { errors: [] as string[] });
        return shell(() => (
            <div style={{ padding: "24px", width: "480px" }}>
                <PaperAudio src={query.get("src")!} waveform={false} label="Clip" onError={(message) => t.errors.push(message)} />
            </div>
        ));
    },

    uncaught() {
        return shell(() => <p id="page">A page that fails.</p>);
    },

    // a poll whose first call is refused
    polling() {
        const Poller = () => {
            createPolling(() => Promise.reject(new Error("the status check failed")), 60_000, { immediate: true });
            return <p id="page">A page that polls.</p>;
        };
        return shell(() => <Poller />);
    },

    provider() {
        const [theme, setTheme] = createSignal<ThemeMode | undefined>((query.get("theme") as ThemeMode | null) ?? undefined);
        window.t = { setTheme };
        return (
            <PaperProvider theme={theme()}>
                <p>themed</p>
            </PaperProvider>
        );
    },
};

async function mount() {
    const scenario = scenarios[query.get("s") ?? ""];
    if (!scenario) throw new Error(`no scenario named ${JSON.stringify(query.get("s"))}`);
    render(scenario, document.getElementById("root")!);
    // the root holds its first paint until the icon font is in
    await document.fonts.ready;
    await new Promise<void>((resolve, reject) => {
        const start = performance.now();
        const check = () => {
            if (!document.querySelector(".paperui-root.iconsPending")) return resolve();
            if (performance.now() - start > 10_000) return reject(new Error("the icon font never loaded"));
            setTimeout(check, 5);
        };
        check();
    });
    window.fixtureReady = true;
}

mount().catch((err: unknown) => {
    window.fixtureError = err instanceof Error ? (err.stack ?? err.message) : String(err);
});
