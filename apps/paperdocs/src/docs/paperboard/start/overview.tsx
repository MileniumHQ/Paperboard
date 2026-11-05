import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PaperboardOverviewDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">What is Paperboard</PaperText>
            <PaperText preset="body" as="p">
                Paperboard is a desktop app that runs self-hosted programs, called panels, on computers you own.
                A panel is an app inside Paperboard, such as a game server manager or a terminal.
                One Paperboard window manages this computer and any other computer you connect to it.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="the-parts">The parts</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Part</th>
                        <th>What it is</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>Paperboard</td>
                        <td>The desktop app for Windows, macOS and Linux. It shows your computers, their panels and your Home page.</td>
                    </tr>
                    <tr>
                        <td>Panel</td>
                        <td>An app that runs inside Paperboard. It is installed on one computer and runs there, whether or not the Paperboard window is open on another one.</td>
                    </tr>
                    <tr>
                        <td>Panel Library</td>
                        <td>The list of panels you can install. Every panel in it is reviewed by the Paperboard team.</td>
                    </tr>
                    <tr>
                        <td>Home</td>
                        <td>A page of widgets from your panels, from every computer, in one place.</td>
                    </tr>
                    <tr>
                        <td>Paperboard server daemon</td>
                        <td>The program that runs panels on a computer. The desktop app has one built in for its own computer. On a computer you manage from somewhere else, such as a headless server, you run it on its own. Its file is called <PaperCode>papercrane</PaperCode>.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="the-window">The Paperboard window</PaperText>
            <PaperText preset="body" as="p">
                The narrow bar on the left is the rail. From top to bottom it holds:
            </PaperText>
            <PaperTextList>
                <li><b>Home</b>, your widgets.</li>
                <li>One button for each computer. The first is <b>This Computer</b>.</li>
                <li><b>Add Computer</b>, the plus button, which connects another computer.</li>
                <li><b>Settings</b>, for the app itself.</li>
            </PaperTextList>
            <PaperText preset="body" as="p">
                Pick a computer and its sidebar opens. The top entry is the computer itself and opens its Computer Info page.
                Below it are <b>Panel Library</b> and the panels installed on that computer.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="one-computer-or-many">One computer or many</PaperText>
            <PaperText preset="body" as="p">
                With only the desktop app, Paperboard runs panels on the computer it is installed on.
                That built-in daemon listens on this computer only, so no other computer can connect to it.
            </PaperText>
            <PaperText preset="body" as="p">
                To manage another computer, run the Paperboard server daemon on it and pair it once with the desktop app.
                After that the computer shows up in the rail, and its panels keep running when your desktop app is closed.
                See <PaperLink href="/docs/paperboard/server-daemon/">Install the server daemon</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="first-party-panels">Panels from the Paperboard team</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Panel</th>
                        <th>What it does</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td>Game Server</td><td>Runs and manages dedicated Minecraft and Terraria servers, with backups.</td></tr>
                    <tr><td>Terminal</td><td>A shell on the computer, with tabs.</td></tr>
                    <tr><td>Bot Creator</td><td>Creates and runs Discord bots.</td></tr>
                    <tr><td>Actions</td><td>Builds automations from the actions panels offer.</td></tr>
                    <tr><td>Agents</td><td>An agent you text, with a web browser of its own. It thinks with Codex, Claude or OpenCode.</td></tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                To make a panel of your own, start with the <PaperLink href="/docs/developers/overview/">Developers</PaperLink> section.
            </PaperText>

            <PaperText preset="body" as="p">
                Next: <PaperLink href="/docs/paperboard/install/">install Paperboard</PaperLink>.
            </PaperText>
        </PaperFlex>
    );
}
