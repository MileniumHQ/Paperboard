import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";

export default function PaperApiOverviewDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperAPI</PaperText>
            <PaperText preset="body">
                PaperAPI connects Paperboard panels to the host operating system, background daemon processes, and peer panels.
                Reach for PaperAPI when implementing panel background services, managing child processes, persisting configuration, or registering actions.
                The runtime operates across both frontend browser frames and Node service processes.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                PaperAPI acts as the typed communication bridge between your panel code and the host Paperboard daemon.
                Panels communicate with the host daemon through WebSocket RPC frames and structured event subscriptions.
                The API separates UI presentation in browser frames from long-running background tasks in service workers.
            </PaperText>

            <PaperText preset="subheader" id="architecture">Architecture</PaperText>
            <PaperText preset="body">
                A standard panel consists of two cooperating environments:
            </PaperText>
            <PaperCard padding="double" surface="front">
                <PaperFlex direction="column" gap="full">
                    <PaperText preset="body" weight={700}>UI Frame (Frontend)</PaperText>
                    <PaperText preset="body" color="text-subtle">
                        A SolidJS application rendered inside an isolated frame.
                        Uses createPanelBridge to synchronize state with the service and call actions.
                    </PaperText>
                    <PaperText preset="body" weight={700}>Service (Backend)</PaperText>
                    <PaperText preset="body" color="text-subtle">
                        A long-running Node process supervised by the Paperboard daemon.
                        Uses definePanelService to maintain state, run tasks, and handle RPC calls.
                    </PaperText>
                </PaperFlex>
            </PaperCard>

            <PaperText preset="subheader" id="security-and-identity">Security and identity</PaperText>
            <PaperText preset="body">
                Paperboard enforces explicit identity across all subsystem boundaries.
                Every RPC call, file path, secret request, and action registration derives its scope from the authenticated panel identifier.
                Panel tokens carry explicit claims issued at launch to prevent cross-panel resource access.
            </PaperText>

            <PaperText preset="subheader" id="subsystem-index">Subsystem index</PaperText>
            <PaperText preset="body">
                PaperAPI provides the following public modules:
            </PaperText>

            <PaperTable>
                <thead>
                    <tr>
                        <th>Module</th>
                        <th>Description</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>actions</PaperCode></td>
                        <td>Register RPC handlers, define custom types, and emit reactive triggers.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>bridge</PaperCode></td>
                        <td>Synchronize UI state with background services via createPanelBridge.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>service</PaperCode></td>
                        <td>Define supervised backend processes using definePanelService.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>config</PaperCode></td>
                        <td>Persist JSON configuration documents and workspace files.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>file</PaperCode></td>
                        <td>Read, write, verify, and download files within panel storage boundaries.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>process</PaperCode></td>
                        <td>Spawn and supervise child processes with streaming stdout and stderr.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>terminal</PaperCode></td>
                        <td>Manage interactive pseudoterminals with resize and keystroke forwarding.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>secrets</PaperCode></td>
                        <td>Store and retrieve credentials from the secure daemon vault.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>package</PaperCode></td>
                        <td>Verify and download system tools and runtime binary distributions.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>system</PaperCode></td>
                        <td>Inspect operating system metrics, trigger alerts, and read network IPs.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>shell</PaperCode></td>
                        <td>Resolve platform-specific execution shells for one-shot commands.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>panels</PaperCode></td>
                        <td>Query installed panels and browse the registry index.</td>
                    </tr>
                </tbody>
            </PaperTable>
        </PaperFlex>
    );
}
