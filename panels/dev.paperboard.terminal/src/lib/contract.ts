// What the terminal's page and its service say to each other: the calls the
// page makes, and the state every window mirrors. Both import this file.
import { defineContract, shape, type Infer } from "@mileniumhq/paperapi";
import { PANEL_ID } from "./panel";

const layout = shape.oneOf("horizontal", "vertical");
const direction = shape.oneOf("right", "down");
export type TabLayout = Infer<typeof layout>;
export type SplitDirection = Infer<typeof direction>;

const sessionFields = {
    id: shape.text(),
    /** the shell it starts with, one of terminalApi.shells(); the computer's default when absent */
    shell: shape.optional(shape.text()),
    /** the folder its shell was last in; a new shell for it starts there */
    cwd: shape.optional(shape.text()),
};
const session = shape.object(sessionFields);
export type TerminalSession = Infer<typeof session>;

const tab = shape.object({
    ...sessionFields,
    label: shape.text(),
    /**
     * The label was chosen: the tab was named when it opened, or renamed.
     * An unnamed tab is called by the program in front of it.
     */
    named: shape.optional(shape.boolean()),
    /** a second shell beside the first */
    split: shape.optional(shape.object({ direction, session })),
});
export type TerminalTab = Infer<typeof tab>;

/** what a session's shell has said since it started */
const liveSession = shape.object({
    /** the program in front of it ("" until the shell is running) */
    program: shape.text(),
    /** the folder its shell is in ("" until it says) */
    cwd: shape.text(),
    /** the last command it ran; seq grows with every command any shell runs */
    command: shape.optional(shape.object({ line: shape.text(), exitCode: shape.number(), seq: shape.number() })),
});
export type LiveSession = Infer<typeof liveSession>;

/**
 * What went wrong for a session in the background, by what it was about:
 * its shell starting, its saved output, its saved folder, or its screen
 * size. Each stands until the same thing works again, so the panel (and a
 * flow reading the state) can say it while it is true.
 */
const sessionErrors = shape.record(
    shape.object({
        start: shape.optional(shape.text()),
        scrollback: shape.optional(shape.text()),
        folder: shape.optional(shape.text()),
        size: shape.optional(shape.text()),
    }),
);
export type SessionErrors = Infer<typeof sessionErrors>;
export type SessionErrorKind = keyof SessionErrors[string];

const savedCommand = shape.object({ id: shape.text(), label: shape.text(), command: shape.text() });
export type SavedCommand = Infer<typeof savedCommand>;

// output: the last lines it printed (stdout and stderr together), when it printed any
const ended = { startedAt: shape.number(), endedAt: shape.number(), output: shape.optional(shape.text()) };
const commandRun = shape.either(
    shape.object({ state: shape.oneOf("running"), startedAt: shape.number() }),
    shape.object({ state: shape.oneOf("exited"), ...ended, exitCode: shape.number() }),
    /** killed after its deadline; the exit was observed, its code is not the command's verdict */
    shape.object({ state: shape.oneOf("timed-out"), ...ended }),
    /** stopped on request before it finished; the exit was observed, its code is not the command's verdict */
    shape.object({ state: shape.oneOf("stopped"), ...ended }),
    /** the daemon refused the spawn, or no exit ever arrived; not an exit code */
    shape.object({ state: shape.oneOf("failed"), ...ended, error: shape.text() }),
);
export type CommandRun = Infer<typeof commandRun>;

const state = shape.object({
    // the tab list every window mirrors; which tab a window shows is that
    // window's own choice, so open windows and computers stay in step
    tabs: shape.list(tab),
    activeTabId: shape.text(),
    // what each session's shell has said, keyed by session id (a split's too)
    live: shape.record(liveSession),
    // tabs along the top, or down the side; every window follows it
    layout,
    // Show Tab's request that every open window switch to a tab; each request
    // has its own token, so a window follows it once
    showTab: shape.object({ id: shape.text(), request: shape.text() }),
    // saved commands (run from Home's "Pinned command" widget) and the last
    // observed outcome of each
    savedCommands: shape.list(savedCommand),
    commandRuns: shape.record(commandRun),
    savedCommandsError: shape.text(),
    // why tabs.json could not be read; while it is set the tabs are not
    // written, so the file stays as it was
    tabsError: shape.text(),
    // what went wrong for a session where no one was waiting on it, by session id
    sessionErrors,
    // the home folder of the computer the shells run on, which a folder is shown from as ~
    home: shape.text(),
});
export type TerminalState = Infer<typeof state>;

const byId = shape.object({ id: shape.text() });

/** what a shell printed while its screen was one size (lib/scrollback.ts) */
const scrollbackRun = shape.object({ cols: shape.optional(shape.number()), rows: shape.optional(shape.number()), text: shape.text() });

export const terminalContract = defineContract(PANEL_ID, {
    calls: {
        /** opens a tab; its shell starts in the folder of `besides` (a session), or `cwd`, or the default */
        createTab: {
            input: shape.object({
                label: shape.optional(shape.text()),
                cwd: shape.optional(shape.text()),
                shell: shape.optional(shape.text()),
                besides: shape.optional(shape.text()),
            }),
            output: shape.text(),
        },
        /** a second shell beside the tab's; its session id */
        splitTab: { input: shape.object({ id: shape.text(), direction }), output: shape.text() },
        unsplitTab: { input: byId, output: shape.nothing() },
        setTabLayout: { input: shape.object({ layout }), output: shape.nothing() },
        /**
         * Attaches the page to a session and gives back its scrollback. Every
         * screen a window mounts opens its session, shown or not, so opening
         * says nothing about which tab is in front: touchTab says that.
         */
        openTab: { input: shape.object({ id: shape.text(), cols: shape.optional(shape.number()), rows: shape.optional(shape.number()) }), output: shape.list(scrollbackRun) },
        /** sets a session's screen size; its scrollback notes it, so it replays at the sizes it was printed at */
        resizeTab: { input: shape.object({ id: shape.text(), cols: shape.number(), rows: shape.number() }), output: shape.nothing() },
        renameTab: { input: shape.object({ id: shape.text(), label: shape.text() }), output: shape.nothing() },
        closeTab: { input: byId, output: shape.nothing() },
        reorderTabs: { input: shape.object({ orderedIds: shape.list(shape.text()) }), output: shape.nothing() },
        /** the tab the page last showed is the one a new window opens on; false for a tab gone by now */
        touchTab: { input: byId, output: shape.boolean() },
        /** saves a command; its id */
        saveCommand: { input: shape.object({ label: shape.text(), command: shape.text() }), output: shape.text() },
        removeSavedCommand: { input: byId, output: shape.nothing() },
        /** reads the saved commands again after they couldn't be read; throws why when they still can't be */
        reloadSavedCommands: { output: shape.nothing() },
        /** starts a saved command; its exit arrives through the state */
        runSavedCommand: { input: byId, output: shape.object({ startedAt: shape.number() }) },
    },
    state: {
        shape: state,
        initial: {
            tabs: [],
            activeTabId: "",
            live: {},
            layout: "horizontal",
            showTab: { id: "", request: "" },
            savedCommands: [],
            commandRuns: {},
            savedCommandsError: "",
            tabsError: "",
            sessionErrors: {},
            home: "",
        },
    },
});
