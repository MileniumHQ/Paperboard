import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function StateDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">State and saving</PaperText>
            <PaperText preset="body" as="p">
                Five Solid helpers for what every view does with its service: read its data, drop an answer that something newer replaced, run an action that shows why it didn't happen, save a control the one way controls save, and take pushed state without rebuilding the rows that didn't change.
                Each imports from <PaperCode>@mileniumhq/paperui</PaperCode> and is called where a component is created.
            </PaperText>
            <PaperText preset="body" as="p">
                They also import from <PaperCode>@mileniumhq/paperui/headless</PaperCode>, which loads without a page: no component and no CSS, only Solid.
                Code that a Bun test runs, such as a page's store or a launcher's logic, imports them from there. The haptics (<PaperCode>haptic</PaperCode>, <PaperCode>playHaptic</PaperCode>, <PaperCode>setHapticPlayer</PaperCode>) are in it too. Both entries share the same modules, so a value made through one is the value the other sees.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="create-read">createRead</PaperText>
            <PaperCode block language="tsx">
{`createRead<T, S = true>(fetcher: (source: S) => Promise<T>, options?: ReadOptions<T, S>): Read<T>;

interface ReadOptions<T, S> {
    /** reads at once and on each change; false, null or undefined reads nothing */
    source?: Accessor<S | false | null | undefined>;
    /** the field array items are matched by across reads (default "id") */
    key?: string;
    /** what the service pushes: subscribe with land, return the function that stops it */
    follow?: (land: (change: ReadChange<T>) => void) => () => void;
    /** a failure's words, as the view shows them (default its own message) */
    message?: (err: unknown) => string;
    /** says a failed read as a danger toast; retry gives it a Try again button */
    failure?: { title: string; retry?: boolean };
}

interface Read<T> {
    /** the last answer, push or set; undefined until the first */
    value: Accessor<T | undefined>;
    /** a read is out */
    loading: Accessor<boolean>;
    /** why the newest read failed, until the next answer */
    error: Accessor<string | null>;
    /** reads again; resolves once it settled, never rejects */
    reload: () => Promise<void>;
    /** resolves once no read is out, never rejects */
    ready: () => Promise<void>;
    /** a change the view knows is newer, such as an action's answer */
    set: (change: ReadChange<T>) => void;
}

/** a whole value (undefined forgets it), or a function for the part that changed */
type ReadChange<T> = T | undefined | ((prev: T | undefined) => T | undefined);`}
            </PaperCode>
            <PaperText preset="body" as="p">
                Data a view reads from its service: the last answer, whether a read is out, and why the newest one failed. Late answers lose without a token to check: only the newest read lands, and nothing lands once the component is gone.
            </PaperText>
            <PaperCode block language="tsx">
{`import { createRead, PaperButton, PaperEmptyState, PaperLoader } from "@mileniumhq/paperui";

const worlds = createRead(() => service.calls.listWorlds(), {
    source: () => state().worldsRevision,
    failure: { title: "Couldn't load the worlds" },
});

<Switch>
    <Match when={worlds.value()}>
        {(list) => <For each={list()}>{(world) => <WorldRow world={world} />}</For>}
    </Match>
    <Match when={worlds.error()}>
        <PaperEmptyState icon="error" title="Couldn't load">
            <PaperButton disabled={worlds.loading()} onClick={() => void worlds.reload()}>Try again</PaperButton>
        </PaperEmptyState>
    </Match>
    <Match when={true}>
        <PaperLoader loaderStatus="indeterminate" label="Reading worlds" />
    </Match>
</Switch>`}
            </PaperCode>
            <PaperTextList>
                <li>Without <PaperCode>source</PaperCode> it reads once, at once. With one, it reads each time the source changes, and the fetcher gets its value. While the source is <PaperCode>false</PaperCode>, <PaperCode>null</PaperCode> or <PaperCode>undefined</PaperCode> nothing is read, and a read still out is dropped. A dialog that reads each time it opens passes <PaperCode>{"source: () => props.open"}</PaperCode>.</li>
                <li>An answer is reconciled into what was there, so every row of a list keeps its identity and only what changed in it redraws. Items are matched by <PaperCode>key</PaperCode>, and items without it by position.</li>
                <li>A failure keeps the value that was there, and <PaperCode>error()</PaperCode> says why until the next answer lands.</li>
                <li>With <PaperCode>failure</PaperCode>, a failed read is a danger toast (see <PaperLink href="/docs/paperui/papertoast/#create-failure-toast">createFailureToast</PaperLink>): the title is what failed and the message is <PaperCode>error()</PaperCode>, so the view formats nothing. It closes while a read is out and comes back if that one fails too; a toast the person closed stays closed while the same failure stands. <PaperCode>retry: true</PaperCode> adds Try again, repeating the view's own.</li>
                <li>Old data stays on screen and the toast says the reload failed. With no data, the view shows <PaperLink href="/docs/paperui/paperemptystate/#couldnt-load">"Couldn't load"</PaperLink> with its own Try again, never a blank body.</li>
                <li><PaperCode>loading()</PaperCode> is true while a read is out, the first one and every reload. A view that keeps its rows on screen during a reload shows the loader only while <PaperCode>value()</PaperCode> is undefined.</li>
                <li>A push (through <PaperCode>follow</PaperCode>) and a <PaperCode>set</PaperCode> are changes newer than any read still out. A whole value lands like an answer and drops that read: the list a remove answered with, or the state a service pushed. <PaperCode>set(undefined)</PaperCode> forgets the value, as before the first read: a view whose data went away.</li>
                <li>A function changes the part it knows, such as a row taken out after it went, or a progress line pushed while the list is read. It applies at once, and again to the answer of the read still out, so that answer can't bring back what it changed.</li>
                <li><PaperCode>follow</PaperCode> is any subscribe function: it gets <PaperCode>land</PaperCode> and returns the function that stops it. The read stops it when the component goes.</li>
                <li>A service's state pushes only what changed. Follow it as a function, so a push that comes before the first answer joins that answer instead of standing for the whole state: <PaperCode>{"follow: (land) => service.state.subscribe((_state, patch) => land((prev) => prev && { ...prev, ...patch }))"}</PaperCode>.</li>
                <li>A poll is <PaperLink href="/docs/paperui/utilities/#polling">createPolling</PaperLink> calling <PaperCode>reload</PaperCode>: a tick never starts while the last read is out.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="create-latest">createLatest</PaperText>
            <PaperCode block language="tsx">
{`createLatest(): Latest;

interface Latest {
    /** starts the work; current() is true while it is the newest and the view is there */
    (): () => boolean;
    /** drops the work in flight without starting a new one */
    cancel(): void;
}`}
            </PaperCode>
            <PaperText preset="body" as="p">
                Late answers lose, for work that isn't a read. <PaperCode>createRead</PaperCode> is for data a view shows, and does this itself; <PaperCode>createLatest</PaperCode> is only for work whose answer starts more work instead of being shown: an action a person can cancel (a sign-in, a message sent from a page they can leave), a probe the caller acts on, or an answer written into something that isn't Solid state, such as a terminal's scrollback or a canvas.
                Each call of the function it returns starts the work and hands back <PaperCode>current()</PaperCode>, which is true while no newer call has started and the component is still there.
                Check it after every <PaperCode>await</PaperCode>, before the answer or its failure lands on screen.
            </PaperText>
            <PaperCode block language="tsx">
{`import { createLatest } from "@mileniumhq/paperui";

// a message sent from one server's page is never confirmed on another's
const sends = createLatest();
const send = async () => {
    const current = sends();
    try {
        await service.calls.sendMessage({ channel: channelId(), content: content() });
        if (current()) setSentTo(channelId());
    } catch (err) {
        if (current()) setSendError(errorMessage(err));
    }
};
const openServer = (id: string) => {
    sends.cancel();
    setServerId(id);
};`}
            </PaperCode>
            <PaperTextList>
                <li>Work that a newer call replaced is dropped, whether it answered or failed.</li>
                <li>Every call is dropped once the component that made it is gone. Made outside a component, only a newer call or <PaperCode>cancel()</PaperCode> replaces one.</li>
                <li><PaperCode>cancel()</PaperCode> drops the work in flight when nothing replaces it: the person closed the dialog, went back a step, or picked nothing.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="create-action">createAction</PaperText>
            <PaperCode block language="tsx">
{`createAction(options?: { message?: (err: unknown) => string }): Action;

interface Action {
    busy: Accessor<boolean>;
    error: Accessor<ActionFailure | null>;
    setError: (failure: ActionFailure | null) => void;
    run(title: string, fn: () => Promise<unknown>, setFailure?: (failure: ActionFailure | null) => void): Promise<boolean>;
}

interface ActionFailure {
    /** the action that didn't happen, such as "Server not removed" */
    title: string;
    /** the failure's own words */
    message: string;
}`}
            </PaperCode>
            <PaperText preset="body" as="p">
                An action a button starts. Make one per action, so each shows its own error next to its own button.
            </PaperText>
            <PaperCode block language="tsx">
{`import { createAction, PaperButton, PaperText } from "@mileniumhq/paperui";

const remove = createAction();

<PaperButton disabled={remove.busy()} onClick={() => remove.run("Server not removed", () => service.calls.remove({ id }))}>
    Remove
</PaperButton>
<Show when={remove.error()}>
    {(failure) => <PaperText color="danger">{failure().title}: {failure().message}</PaperText>}
</Show>`}
            </PaperCode>
            <PaperTextList>
                <li><PaperCode>busy</PaperCode> is true while any run is going.</li>
                <li>A run clears the last error as it starts. A failure becomes the title and the error's own message.</li>
                <li>Pass <PaperCode>message</PaperCode> when a failure's own words aren't what the view shows, such as a system code like <PaperCode>EACCES</PaperCode> said as a sentence about the file. Give one formatter to every action of a panel.</li>
                <li>Under a field, show only <PaperCode>error()?.message</PaperCode>: the field says what the action was.</li>
                <li><PaperCode>run</PaperCode> resolves <PaperCode>true</PaperCode> when <PaperCode>fn</PaperCode> went through and <PaperCode>false</PaperCode> when it failed. It never rejects.</li>
                <li>Pass <PaperCode>setFailure</PaperCode> to show a run's failure somewhere else, such as inside a confirmation that stays open. The action's own <PaperCode>error</PaperCode> is left alone.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="create-saved-value">createSavedValue</PaperText>
            <PaperCode block language="tsx">
{`createSavedValue<T>(
    stored: Accessor<T>,
    save: (value: T) => Promise<boolean | void>,
    options?: { queue?: SaveQueue },
): SavedValue<T>;

interface SavedValue<T> {
    /** what the control shows: the change being saved, else what is saved */
    value: Accessor<T>;
    /** shows next at once and saves it after the saves made before it */
    set: (next: T) => Promise<void>;
    /** a change of this value is saving or waiting to */
    saving: Accessor<boolean>;
}

type SaveQueue = <R>(task: () => Promise<R>) => Promise<R>;`}
            </PaperCode>
            <PaperText preset="body" as="p">
                The one way a control saves: it flips at once, saves in order, and falls back with an error. A control is never disabled for its own save.
                <PaperCode>stored</PaperCode> is what is saved, as the view last read it or the service pushed it.
            </PaperText>
            <PaperCode block language="tsx">
{`import { createSavedValue, PaperToggle } from "@mileniumhq/paperui";

const whitelist = createSavedValue(() => state().whitelist, (on) => service.calls.setWhitelist({ on }));

<PaperToggle
    aria-label="Whitelist"
    checked={whitelist.value()}
    onChange={(on) => whitelist.set(on).catch((err) => setError(\`Whitelist not changed: \${errorMessage(err)}\`))}
/>`}
            </PaperCode>
            <PaperTextList>
                <li>A change shows at once. Saves run one at a time in the order they were made, so an older one never lands over a newer one. A change that a newer one replaced before its turn is not written at all.</li>
                <li>When the newest save fails, the control goes back to what is saved (the last change that landed, else <PaperCode>stored</PaperCode>) and <PaperCode>set</PaperCode> rejects with the save's own error. Catch it to show the error beside the control. A rejection handed back to <PaperLink href="/docs/paperui/papertoggle/">PaperToggle</PaperLink>'s <PaperCode>onChange</PaperCode> uncaught reaches the error toast.</li>
                <li>A <PaperCode>save</PaperCode> that resolves <PaperCode>false</PaperCode> was called off by the person, such as a folder picker closed: the control goes back with no error.</li>
                <li>A save that landed shows its value until <PaperCode>stored</PaperCode> catches up. When the save's own answer changes <PaperCode>stored</PaperCode> (a name trimmed), <PaperCode>stored</PaperCode> shows.</li>
                <li><PaperCode>stored</PaperCode> changing while nothing saves is the truth, and shows. While a change saves, it stays on screen. A push equal to the last one, by <PaperCode>sameData</PaperCode>, is no change.</li>
                <li>Pass one <PaperCode>queue</PaperCode> to every setting of a view, and run the work that must not land between their saves through it too. PaperAPI's <PaperCode>new SerialQueue().run</PaperCode> is one.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="keep-unchanged">keepUnchanged and createStateSignal</PaperText>
            <PaperCode block language="tsx">
{`keepUnchanged<T>(prev: T, next: T): T;
sameData(a: unknown, b: unknown): boolean;
createStateSignal<T>(initial: T): [Accessor<T>, (next: T | ((prev: T) => T)) => void];`}
            </PaperCode>
            <PaperText preset="body" as="p">
                A service pushes a fresh copy of its state each time. Handed to a <PaperCode>{"<For>"}</PaperCode> as it is, every row would be rebuilt, and a switch that is rebuilt doesn't animate.
                <PaperCode>keepUnchanged</PaperCode> returns <PaperCode>next</PaperCode> with every part that equals <PaperCode>prev</PaperCode> replaced by the very object <PaperCode>prev</PaperCode> held, and <PaperCode>prev</PaperCode> itself when nothing changed.
            </PaperText>
            <PaperTextList>
                <li>Arrays of items with an <PaperCode>id</PaperCode> (a string or a number) match them by it, wherever they moved. Other arrays match by position.</li>
                <li>Sets and Maps match by key, and plain objects by field. Anything else is equal only when it is the same value.</li>
                <li><PaperCode>sameData</PaperCode> is whether two values hold the same data by these rules.</li>
                <li><PaperCode>createStateSignal</PaperCode> is a signal that runs every set through <PaperCode>keepUnchanged</PaperCode>: an equal push notifies no one, and a changed one keeps the rows that didn't change.</li>
            </PaperTextList>
            <PaperCode block language="tsx">
{`import { createStateSignal } from "@mileniumhq/paperui";

const [players, setPlayers] = createStateSignal<Player[]>([]);
service.state.subscribe((state) => setPlayers(state.players));

<For each={players()}>{(player) => <PlayerRow player={player} />}</For>`}
            </PaperCode>
        </PaperFlex>
    );
}
