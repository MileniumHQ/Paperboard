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
                Four Solid helpers for what every view does with its service: read something without an older answer landing over a newer one, run an action that shows why it didn't happen, save a control the one way controls save, and take pushed state without rebuilding the rows that didn't change.
                Each imports from <PaperCode>@mileniumhq/paperui</PaperCode> and is called where a component is created.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="create-latest">createLatest</PaperText>
            <PaperCode block language="tsx">
{`createLatest(): () => () => boolean;`}
            </PaperCode>
            <PaperText preset="body" as="p">
                Late answers lose. Each call of the function it returns starts a read and hands back <PaperCode>current()</PaperCode>, which is true while no newer read has started and the component is still there.
                Check it after every <PaperCode>await</PaperCode>, before the answer or its failure lands on screen.
            </PaperText>
            <PaperCode block language="tsx">
{`import { createLatest } from "@mileniumhq/paperui";

const latest = createLatest();
const load = async () => {
    const current = latest();
    try {
        const next = await service.calls.listWorlds();
        if (current()) setWorlds(reconcile(next, { key: "id" }));
    } catch (err) {
        if (current()) setError(errorMessage(err));
    }
};`}
            </PaperCode>
            <PaperTextList>
                <li>A read that a newer one replaced is dropped, whether it answered or failed.</li>
                <li>Every read is dropped once the component that made it is gone. Made outside a component, only a newer read replaces one.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="create-action">createAction</PaperText>
            <PaperCode block language="tsx">
{`createAction(): Action;

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
bridge.onStateChange((state) => setPlayers(state.players));

<For each={players()}>{(player) => <PlayerRow player={player} />}</For>`}
            </PaperCode>
        </PaperFlex>
    );
}
