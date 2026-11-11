// The Blocks editor: Blockly's canvas with every panel's blocks in its
// toolbox, Run and Stop above it, and the run log below. Edits save as you
// make them; the service runs the flows.
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import * as Blockly from "blockly";
import { blocksApi, createPanelBridge, panelsApi, type BlockInfo } from "@mileniumhq/paperapi";
import { PaperButton, PaperConsole, PaperFlex, PaperText, type PaperConsoleEntry } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import "@mileniumhq/paperui/panel.css";
import { BUILTIN_BLOCKS, BUILTIN_SECTIONS, choicesSources, registryDefinitions } from "./lib/blockDefs";
import { refreshChoices, registerChoicesField } from "./lib/choicesField";
import { errorMessage } from "./lib/failure";
import type { SavedWorkspace } from "./lib/interpreter";
import { DEFAULT_STATE, PANEL_ID, SERVICE_ACTIONS, type PanelState, type SavedFlows } from "./panel";
import styles from "./App.module.css";

const SAVE_DELAY_MS = 400;

const bridge = createPanelBridge<PanelState>({ panelId: PANEL_ID, defaultState: DEFAULT_STATE });

/** Replaces block definitions, so a registry change redefines them without a warning per block. */
function define(blocks: Record<string, unknown>[]): void {
    for (const block of blocks) delete Blockly.Blocks[block.type as string];
    Blockly.common.defineBlocksWithJsonArray(blocks);
}

export default function App() {
    let host!: HTMLDivElement;
    let workspace: Blockly.WorkspaceSvg | undefined;
    const [state, setState] = createSignal<PanelState>(bridge.getState());
    const [problem, setProblem] = createSignal<string | null>(null);
    // the schemas of the blocks on the canvas, as last seen: saved with the flows
    let schemas: SavedFlows["schemas"] = {};
    let live = new Set<string>();
    let loading = true;
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    let shownErrors = 0;

    const fail = (what: string) => (err: unknown) => setProblem(`${what}: ${errorMessage(err)}`);

    /** Defines every block the registry and the saved flows name, and returns the toolbox. */
    async function refreshBlocks(saved: SavedFlows["schemas"]): Promise<Blockly.utils.toolbox.ToolboxDefinition> {
        const [entries, panels, projects] = await Promise.all([blocksApi.list(), panelsApi.list(), blocksApi.projects()]);
        // ask for every dropdown's choices now, so a loaded flow shows them; one that fails says so
        await Promise.all(
            choicesSources(entries).map((source) =>
                refreshChoices(source).catch((err: unknown) => setProblem(`The choices for ${panels.find((p) => p.id === source.panelId)?.name ?? source.panelId} couldn't be loaded: ${errorMessage(err)}`)),
            ),
        );
        const liveDefs = registryDefinitions(entries, projects);
        live = new Set(Object.keys(liveDefs.schemas));
        // a block whose panel is away keeps the shape it was saved with
        const away: BlockInfo[] = Object.entries(saved)
            .filter(([type]) => !live.has(type))
            .map(([, s]) => ({ panelId: s.panelId, entry: s.entry, schema: s.schema }));
        const awayDefs = registryDefinitions(away);
        define([...BUILTIN_BLOCKS, ...awayDefs.blocks, ...liveDefs.blocks]);
        schemas = { ...awayDefs.schemas, ...liveDefs.schemas };

        const panelName = (id: string) => panels.find((p) => p.id === id)?.name ?? id;
        const projectName = (panelId: string, id: string) => projects.find((p) => p.panelId === panelId && p.id === id)?.name ?? id;
        // panel > project > the blocks' own categories; a level with one group shows its blocks directly
        type Json = Record<string, unknown>;
        const grouped = (sections: typeof liveDefs.sections): Json[] => {
            const named = sections.filter((s) => s.category);
            if (named.length === 0 || (named.length === sections.length && named.length === 1)) return sections.flatMap((s) => s.contents);
            return [
                ...sections.filter((s) => !s.category).flatMap((s) => s.contents),
                ...named.map((s) => ({ kind: "category", name: s.category, contents: s.contents })),
            ];
        };
        const byPanel = new Map<string, Json[]>();
        for (const panelId of new Set(liveDefs.sections.map((s) => s.panelId))) {
            const mine = liveDefs.sections.filter((s) => s.panelId === panelId);
            const projects = [...new Set(mine.filter((s) => s.project).map((s) => s.project!))];
            byPanel.set(panelId, [
                ...grouped(mine.filter((s) => !s.project)),
                ...projects.map((project) => ({ kind: "category", name: projectName(panelId, project), contents: grouped(mine.filter((s) => s.project === project)) })),
            ]);
        }
        return {
            kind: "categoryToolbox",
            contents: [
                ...BUILTIN_SECTIONS.map((s) => ({ kind: "category", name: s.name, ...(s.custom ? { custom: s.custom } : { contents: s.contents }) })),
                ...(byPanel.size ? [{ kind: "sep" }] : []),
                ...[...byPanel].map(([panelId, contents]) => ({ kind: "category", name: panelName(panelId), contents })),
            ],
        } as Blockly.utils.toolbox.ToolboxDefinition;
    }

    /** Marks the blocks whose panel isn't offering them right now. */
    function markAway(): void {
        if (!workspace) return;
        for (const block of workspace.getAllBlocks(false)) {
            const saved = schemas[block.type];
            if (!saved) continue;
            block.setWarningText(live.has(block.type) ? null : `${saved.schema.name} isn't available: its panel isn't running`, "away");
        }
    }

    function save(): void {
        if (!workspace) return;
        const saved = Blockly.serialization.workspaces.save(workspace) as SavedWorkspace;
        const used = new Set(workspace.getAllBlocks(false).map((b) => b.type));
        const flows: SavedFlows = { workspace: saved, schemas: Object.fromEntries(Object.entries(schemas).filter(([type]) => used.has(type))) };
        bridge.call(SERVICE_ACTIONS.save, flows).then(() => setProblem(null), fail("Your changes weren't saved"));
    }

    function showErrors(next: PanelState): void {
        if (!workspace) return;
        for (const entry of next.log.slice(shownErrors)) {
            if (entry.level === "error" && entry.blockId) workspace.getBlockById(entry.blockId)?.setWarningText(entry.message, "run");
        }
        shownErrors = next.log.length;
    }

    onMount(() => {
        registerChoicesField({ fetch: (s) => blocksApi.choices(s.panelId, s.entry, s.input), report: setProblem });
        workspace = Blockly.inject(host, {
            toolbox: { kind: "categoryToolbox", contents: [] },
            media: "./blockly-media/",
            trashcan: true,
            zoom: { controls: true, wheel: true },
            move: { scrollbars: true, drag: true, wheel: false },
        });
        const resize = new ResizeObserver(() => workspace && Blockly.svgResize(workspace));
        resize.observe(host);

        workspace.addChangeListener((event: Blockly.Events.Abstract) => {
            if (loading || event.isUiEvent) return;
            clearTimeout(saveTimer);
            saveTimer = setTimeout(save, SAVE_DELAY_MS);
        });

        const offState = bridge.onStateChange((_patch, full) => {
            setState(full);
            showErrors(full);
        });
        const offRegistry = blocksApi.onRegistryChange(() => {
            refreshBlocks(schemas).then((toolbox) => {
                workspace?.updateToolbox(toolbox);
                markAway();
            }, fail("The blocks couldn't be updated"));
        });

        (async () => {
            const flows = await bridge.call<SavedFlows>(SERVICE_ACTIONS.load);
            workspace!.updateToolbox(await refreshBlocks(flows.schemas));
            Blockly.serialization.workspaces.load(flows.workspace, workspace!);
            markAway();
        })().then(
            () => {
                loading = false;
            },
            fail("Your flows couldn't be loaded"),
        );

        onCleanup(() => {
            clearTimeout(saveTimer);
            resize.disconnect();
            offState();
            offRegistry();
            workspace?.dispose();
        });
    });

    const entries = (): PaperConsoleEntry[] =>
        state().log.map((entry) => ({ id: entry.id, type: entry.level === "error" ? "error" : "output", content: entry.message, timestamp: entry.at }));

    const run = () => {
        for (const block of workspace?.getAllBlocks(false) ?? []) block.setWarningText(null, "run");
        bridge.call<number>(SERVICE_ACTIONS.run).then(() => setProblem(null), fail("Run didn't start"));
    };

    return (
        <PaperFlex direction="column" fullWidth fullHeight>
            <PaperFlex direction="row" gap="full" padding="full" align="center">
                <PaperButton variant="primary" onClick={run}>
                    Run
                </PaperButton>
                <PaperButton disabled={state().running === 0} onClick={() => bridge.call(SERVICE_ACTIONS.stop).catch(fail("Stop didn't work"))}>
                    Stop
                </PaperButton>
                <Show when={state().running > 0}>
                    <PaperText preset="body">{state().running === 1 ? "1 flow running" : `${state().running} flows running`}</PaperText>
                </Show>
                <Show when={problem()}>
                    <PaperText preset="body" color="danger">
                        {problem()}
                    </PaperText>
                </Show>
            </PaperFlex>
            <div ref={host} class={styles.canvas} />
            <PaperConsole class={styles.log} title="Run log" showInput={false} entries={entries()} onClear={() => bridge.call(SERVICE_ACTIONS.clearLog).catch(fail("The log wasn't cleared"))} />
        </PaperFlex>
    );
}
