import {
    PaperCode,
    PaperFlex,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PortsApiDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">portApi</PaperText>
            <PaperText preset="body" as="p">
                portApi gives each network port a panel's programs open a number on the computer, so two panels never pick the same one.
                It works on a panel page, in a widget and in a service. Each computer's settings in Paperboard list its claims by label, under Ports.
                Claim every port a server the panel runs listens on.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperCode block language="tsx">
{`import { portApi, processApi } from "@mileniumhq/paperapi";

const PANEL_ID = "dev.example.weather";

// once, when the person sets the relay up
await portApi.claim(PANEL_ID, { name: "relay", label: "Weather relay", protocol: "tcp", preferred: 8080 });

// every time, right before the program starts
const { port } = await portApi.prepare(PANEL_ID, "relay");
await processApi.start({ id: "weather-relay", command: relayPath, args: ["--port", String(port)] });`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="api">API</PaperText>
            <PaperCode block language="tsx">
{`portApi.claim(appId: string, request: PortRequest, scope?: string): Promise<PortClaim>;
portApi.prepare(appId: string, name: string, scope?: string): Promise<PortClaim>;
portApi.release(appId: string, name: string, scope?: string): Promise<void>;
portApi.list(appId: string, scope?: string): Promise<PortClaim[]>;

type PortProtocol = "tcp" | "udp" | "tcp+udp";

interface PortRequest {
    /** the panel's own name for it: a lowercase letter or digit, then letters, digits and dashes; at most 32 */
    name: string;
    /** who holds it, for people: at most 80 characters */
    label: string;
    protocol: PortProtocol;
    /** the number the panel wants, 1 to 65535 */
    preferred: number;
}

interface PortClaim {
    panelId: string;
    name: string;
    label: string;
    protocol: PortProtocol;
    /** the number the program opens */
    port: number;
}`}
            </PaperCode>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Call</th>
                        <th>Behavior</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>claim</PaperCode></td>
                        <td>Gives the name a number: <PaperCode>preferred</PaperCode> when it is free, otherwise as the policy says. A name that already holds <PaperCode>preferred</PaperCode> with the same protocol keeps it with no check, and takes the new label.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>prepare</PaperCode></td>
                        <td>Checks the claimed number again, since another program may have taken it since, and refuses or moves it as the policy says. Call it right before the program starts, while the panel's own program is not running yet, and give the program the number it returns.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>release</PaperCode></td>
                        <td>Gives the number back. Releasing a name that holds nothing does nothing.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>list</PaperCode></td>
                        <td>The panel's claims.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                <PaperCode>appId</PaperCode> is the panel id, and only the caller's own. <PaperCode>scope</PaperCode> is the computer to claim on, the one the document was granted by default.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="taken-ports">Taken ports</PaperText>
            <PaperText preset="body" as="p">
                A port is taken when another claim holds it, or when the daemon can't open it on every interface the way a server would.
                The person picks what happens then with the computer's <PaperCode>Refuse taken ports</PaperCode> setting:
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Policy</th>
                        <th>What happens</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>next-free</PaperCode> (default)</td>
                        <td>The claim moves to the first free port of the next 100. When all of them are taken, the call is refused.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>refuse</PaperCode></td>
                        <td>The call is refused, and the error names who holds the port.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                Show the refusal to the person: it says which port, and why, in their words.
            </PaperText>
            <PaperTextList>
                <li><PaperCode>another program on this computer is using it</PaperCode></li>
                <li><PaperCode>&lt;label&gt; has it</PaperCode>, for another panel's claim</li>
                <li><PaperCode>this computer only lets administrators open ports below 1024</PaperCode></li>
                <li><PaperCode>Windows keeps it for itself (it sets ports aside for Hyper-V and WSL), or another program holds it</PaperCode></li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperTextList>
                <li>Claims are kept in <PaperCode>ports.json</PaperCode> in the Paperboard data folder, and survive restarts.</li>
                <li>A claim stays when the panel is uninstalled and goes when the uninstall deletes the panel's data.</li>
                <li>Claims are made one at a time on each computer, so two panels claiming at once never get the same number.</li>
                <li><PaperCode>portSettingsApi.all</PaperCode> and <PaperCode>portSettingsApi.setPolicy</PaperCode> read and change every claim and the policy. They belong to the computer's settings, and a panel's call is refused.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="errors">Errors</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Error</th>
                        <th>Code</th>
                        <th>Cause</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>&lt;label&gt; can't use port &lt;n&gt;: &lt;reason&gt;.</PaperCode></td><td><PaperCode>CONFLICT</PaperCode></td><td>The port is taken and the policy is <PaperCode>refuse</PaperCode>.</td></tr>
                    <tr><td><PaperCode>&lt;label&gt; can't use port &lt;n&gt; (&lt;reason&gt;), and ports &lt;n+1&gt; to &lt;m&gt; are taken too.</PaperCode></td><td><PaperCode>CONFLICT</PaperCode></td><td>The port and the next 100 are taken.</td></tr>
                    <tr><td><PaperCode>No port named "&lt;name&gt;" is claimed; claim it first.</PaperCode></td><td><PaperCode>NOT_FOUND</PaperCode></td><td><PaperCode>prepare</PaperCode> before <PaperCode>claim</PaperCode>.</td></tr>
                    <tr><td><PaperCode>Invalid port name: "&lt;name&gt;"</PaperCode></td><td><PaperCode>INVALID_PARAMS</PaperCode></td><td>A name outside the rule.</td></tr>
                    <tr><td><PaperCode>A port needs a label of at most 80 characters</PaperCode></td><td><PaperCode>INVALID_PARAMS</PaperCode></td><td>An empty or long label.</td></tr>
                    <tr><td><PaperCode>Invalid protocol: "&lt;value&gt;"</PaperCode>, <PaperCode>Invalid port: &lt;value&gt;</PaperCode></td><td><PaperCode>INVALID_PARAMS</PaperCode></td><td>A protocol other than the three, or a number outside 1 to 65535.</td></tr>
                    <tr><td><PaperCode>ports:all is host-only</PaperCode></td><td><PaperCode>FORBIDDEN</PaperCode></td><td>A panel called <PaperCode>portSettingsApi</PaperCode>.</td></tr>
                </tbody>
            </PaperTable>
        </PaperFlex>
    );
}
