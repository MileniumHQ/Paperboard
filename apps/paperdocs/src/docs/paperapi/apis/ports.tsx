import {
    PaperCode,
    PaperFlex,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";

export default function PortsApiDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">Ports API</PaperText>
            <PaperText preset="body">
                portApi gives the network ports a panel's program opens on the computer.
                A panel claims a port by a name of its own and Paperboard decides its number. It never gives a number another claim holds or another program on the computer is using.
                When the number a panel asks for is taken, the user's setting decides what happens: Paperboard refuses with an error that says who has it, or gives the next free port.
                Reach for portApi when your program listens on a fixed port people connect to, such as a game server. A program that is only reached through Paperboard can listen on a random port and needs no claim.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Import portApi from @mileniumhq/paperapi. Every call names the panel explicitly.
                Claim the port your program's config asks for, check it with prepare right before the program starts, and write the number prepare returns into the config.
                Never assume the number you asked for is the one you got.
            </PaperText>
            <PaperCode block language="tsx">
{`import { portApi } from "@mileniumhq/paperapi";

const PANEL_ID = "dev.example.panel";

async function start() {
    const wanted = await readPortFromConfig();
    await portApi.claim(PANEL_ID, { name: "game", label: "Example Server", protocol: "tcp", preferred: wanted });
    // throws, saying who has it, when the port is taken and the user's setting refuses to move it
    const { port } = await portApi.prepare(PANEL_ID, "game");
    if (port !== wanted) await writePortToConfig(port);
    await startProgram();
}`}
            </PaperCode>

            <PaperText preset="subheader" id="methods-and-signatures">Methods and signatures</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Method</th>
                        <th>Signature</th>
                        <th>Description</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>claim</PaperCode></td>
                        <td><PaperCode>claim(appId, request): Promise&lt;PortClaim&gt;</PaperCode></td>
                        <td>Gives the named port a number. A claim the panel already holds at <PaperCode>preferred</PaperCode> is returned as it is.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>prepare</PaperCode></td>
                        <td><PaperCode>prepare(appId, name): Promise&lt;PortClaim&gt;</PaperCode></td>
                        <td>Checks a claimed port against the computer again, right before the program opens it. Refuses or moves a port something took since it was claimed.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>release</PaperCode></td>
                        <td><PaperCode>release(appId, name): Promise&lt;void&gt;</PaperCode></td>
                        <td>Gives the port back. Releasing a port the panel does not hold does nothing.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>list</PaperCode></td>
                        <td><PaperCode>list(appId): Promise&lt;PortClaim[]&gt;</PaperCode></td>
                        <td>The ports the panel holds.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" id="requests-and-claims">Requests and claims</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Field</th>
                        <th>Type</th>
                        <th>Description</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>name</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>The panel's own name for the port, unique per panel. Lowercase letters, digits and dashes, at most 32.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>label</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>Who holds the port, for people, such as "Game Server (Java)". At most 80 characters. Errors and the computer's Computer Info page show it.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>protocol</PaperCode></td>
                        <td><PaperCode>"tcp" | "udp" | "tcp+udp"</PaperCode></td>
                        <td>What the program opens. A port is checked for each protocol it names.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>preferred</PaperCode></td>
                        <td><PaperCode>number</PaperCode></td>
                        <td>The request's number, 1 to 65535. Pass the one your program's config holds.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>port</PaperCode></td>
                        <td><PaperCode>number</PaperCode></td>
                        <td>On a claim: the number the port has. Write it into your program's config.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" id="taken-ports">Taken ports</PaperText>
            <PaperText preset="body">
                A port is taken when another claim holds it, from any panel, or when another program on the computer has it open.
                By default Paperboard gives the next free port, looking up to 100 past the one asked for. With Refuse taken ports on, in the Ports section of the computer's Computer Info page, claim and prepare throw instead.
                The error names the port and who has it, such as "Game Server (Java) can't use port 25565: another program on this computer is using it." Show it to the user as it is.
                Ports below 1024 need administrator rights on most computers, so a claim of one usually fails.
            </PaperText>

            <PaperText preset="subheader" id="errors">Errors</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Code</th>
                        <th>Meaning</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>CONFLICT</PaperCode></td>
                        <td>The port is taken and the user's setting refuses to move it, or no port within 100 of it is free.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>NOT_FOUND</PaperCode></td>
                        <td>prepare named a port the panel has not claimed.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>FORBIDDEN</PaperCode></td>
                        <td>The appId names another panel than the caller's.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>INVALID_PARAMS</PaperCode></td>
                        <td>A name, label, protocol or port is not one claim accepts.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                claim does not check a port the panel already holds at the same number, because the panel's own program may be using it. Call prepare only while that program is stopped.
                Claims are kept across restarts of the computer's Paperboard Server. Uninstalling a panel and deleting its data releases its ports; uninstalling it and keeping its data keeps them for a reinstall.
                A claim reserves a number in Paperboard; it does not open the port. Another program can still take it while yours is stopped, which prepare catches.
            </PaperText>
        </PaperFlex>
    );
}
