import {
    PaperCode,
    PaperFlex,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";

export default function ServiceApiDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">Service API</PaperText>
            <PaperText preset="body">
                definePanelService initializes a daemon-supervised background process for a Paperboard panel.
                Reach for definePanelService in src/service.ts to maintain state, expose RPC actions, and supervise long-running workloads.
                The runtime handles state hydration actions, delta synchronizations, and lifecycle readiness handshakes.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Invoke definePanelService at the top level of your service entry script.
                Specify initial state, action handlers, and an optional asynchronous onInit hook.
            </PaperText>
            <PaperCode block language="tsx">
{`import { definePanelService } from "@mileniumhq/paperapi";

interface ServiceState {
    status: string;
    uptime: number;
}

const service = definePanelService({
    state: { status: "idle", uptime: 0 },
    actions: {
        start: async (ctx) => {
            ctx.setState({ status: "running" });
            return true;
        },
        getStatus: async (ctx) => {
            return ctx.state.status;
        }
    },
    onInit: async (ctx) => {
        console.log("Service initialized");
    }
});`}
            </PaperCode>

            <PaperText preset="subheader" id="configuration-options">Configuration options</PaperText>
            <PaperText preset="body">
                definePanelService accepts the following options:
            </PaperText>

            <PaperTable>
                <thead>
                    <tr>
                        <th>Option</th>
                        <th>Type</th>
                        <th>Default</th>
                        <th>Description</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>state</PaperCode></td>
                        <td><PaperCode>TState</PaperCode></td>
                        <td><PaperCode>{"{}"}</PaperCode></td>
                        <td>Initial dictionary defining the service state.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>actions</PaperCode></td>
                        <td><PaperCode>TActions | ActionDefinition[]</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Dictionary of action handler functions or structured ActionDefinition schemas.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>types</PaperCode></td>
                        <td><PaperCode>CustomTypeDefinition[]</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Custom data type definitions registered for action input/output validation.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>categories</PaperCode></td>
                        <td><PaperCode>ActionCategoryDefinition[]</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Category sorting and icon metadata for exposed actions.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onInit</PaperCode></td>
                        <td><PaperCode>(ctx: ServiceContext) =&gt; void | Promise&lt;void&gt;</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Lifecycle callback executed after action registration completes.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" id="service-context">Service context</PaperText>
            <PaperText preset="body">
                Action handlers and onInit receive a ServiceContext object:
            </PaperText>

            <PaperTable>
                <thead>
                    <tr>
                        <th>Context member</th>
                        <th>Type</th>
                        <th>Description</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>state</PaperCode></td>
                        <td><PaperCode>TState</PaperCode></td>
                        <td>Read-only accessor for the current state snapshot.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>setState</PaperCode></td>
                        <td><PaperCode>(patchOrUpdater) =&gt; void</PaperCode></td>
                        <td>Updates state values and dispatches synchronization events to connected UI bridges.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>emit</PaperCode></td>
                        <td><PaperCode>(event, payload?) =&gt; void</PaperCode></td>
                        <td>Dispatches a custom event scoped to this panel.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>emitTrigger</PaperCode></td>
                        <td><PaperCode>(triggerId, output) =&gt; void</PaperCode></td>
                        <td>Emits an automation trigger payload to active platform flows.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                definePanelService automatically registers an internal action named state:get to hydrate UI bridges.
                Once onInit completes, the process sends a paperboard:service-ready message to the parent daemon.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Use functional updaters in setState when modifying state based on prior values.
            </PaperText>
            <PaperCode block language="tsx">
{`ctx.setState((prev) => ({
    uptime: prev.uptime + 1
}));`}
            </PaperCode>
        </PaperFlex>
    );
}
