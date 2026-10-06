import {
    PaperCode,
    PaperFlex,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";

export default function BridgeApiDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">Bridge API</PaperText>
            <PaperText preset="body">
                createPanelBridge connects a frontend SolidJS panel interface to its backend daemon service.
                Reach for createPanelBridge in your panel UI root to consume reactive service state and invoke backend actions.
                The bridge provides automatic initial hydration, delta synchronization, and proxy action execution.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Instantiate the bridge in your frontend components.
                Access the current state, listen for delta updates, and call service actions directly through bridge.actions.
            </PaperText>
            <PaperCode block language="tsx">
{`import { createPanelBridge } from "@mileniumhq/paperapi";
import { createSignal, onCleanup } from "solid-js";

interface PanelState {
    running: boolean;
    count: number;
}

interface PanelActions {
    start: () => Promise<void>;
    stop: () => Promise<void>;
}

export function PanelView() {
    const bridge = createPanelBridge<PanelState, PanelActions>({
        defaultState: { running: false, count: 0 },
    });

    const [state, setState] = createSignal(bridge.getState());
    const unsub = bridge.onStateChange((_patch, full) => setState(full));

    onCleanup(() => {
        unsub();
        bridge.dispose();
    });

    return (
        <button onClick={() => bridge.actions.start()}>
            {state().running ? "Stop" : "Start"}
        </button>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" id="bridge-methods">Bridge methods</PaperText>
            <PaperText preset="body">
                createPanelBridge returns an object with state accessors, action proxies, and cleanup routines:
            </PaperText>

            <PaperTable>
                <thead>
                    <tr>
                        <th>Member</th>
                        <th>Type</th>
                        <th>Description</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>getState()</PaperCode></td>
                        <td><PaperCode>() =&gt; TState</PaperCode></td>
                        <td>Returns the latest local snapshot of service state.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>refreshState()</PaperCode></td>
                        <td><PaperCode>() =&gt; Promise&lt;TState&gt;</PaperCode></td>
                        <td>Forces an immediate state hydration request to the service over RPC.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onStateChange(cb)</PaperCode></td>
                        <td><PaperCode>(cb: (patch, full) =&gt; void) =&gt; () =&gt; void</PaperCode></td>
                        <td>Registers a listener invoked when the backend service updates state. Returns an unsubscriber.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>actions</PaperCode></td>
                        <td><PaperCode>TActions</PaperCode></td>
                        <td>Proxy object mapping action method calls to actionsApi.call invocations.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>call(action, ...args)</PaperCode></td>
                        <td><PaperCode>&lt;R&gt;(action: string, ...args: any[]) =&gt; Promise&lt;R&gt;</PaperCode></td>
                        <td>Explicitly calls a named action on the service without using the proxy. The last argument may be <PaperCode>{"{ timeoutMs }"}</PaperCode> — numeric up to 60 s, or <PaperCode>null</PaperCode> to wait for long work.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>getStatus()</PaperCode></td>
                        <td><PaperCode>() =&gt; {"{ ready: boolean; error?: string }"}</PaperCode></td>
                        <td>Reports whether initial state hydration completed successfully.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>dispose()</PaperCode></td>
                        <td><PaperCode>() =&gt; void</PaperCode></td>
                        <td>Tears down hydrator registrations and event subscriptions to prevent memory leaks.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                When a panel mounts, createPanelBridge registers a hydrator with the platform frame manager.
                If the background service is still booting, initial hydration defers and resolves once the service signals readiness.
                State updates dispatched by the service via setState arrive as lightweight delta patches.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Ensure bridge.dispose() runs when your root component unmounts.
            </PaperText>
            <PaperCode block language="tsx">
{`onCleanup(() => {
    bridge.dispose();
});`}
            </PaperCode>
        </PaperFlex>
    );
}
