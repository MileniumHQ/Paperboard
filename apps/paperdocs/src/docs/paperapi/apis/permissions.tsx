import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PermissionsDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">Permissions</PaperText>
            <PaperText preset="body" as="p">
                A panel can reach its own data, any panel's actions and events, the microphone, camera and screen once the person allows it, and the internet.
                Panels are reviewed and first-party, so this isn't a sandbox: a panel can start any program on its computer.
                What the daemon does enforce is ownership, and this page lists it exactly.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="credentials">Credentials</PaperText>
            <PaperTextList>
                <li>Every panel page, widget and service connects with a credential the daemon issued for that one panel. The panel id comes with the credential, never from the page's address or a parameter.</li>
                <li>A page shown from another computer gets a relay credential. It only opens a tunnel to the computer that serves the panel, and that computer's daemon answers the calls. The computer showing the page refuses every call of its own.</li>
                <li>Uninstalling a panel revokes its credentials.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="own-data">The panel's own data</PaperText>
            <PaperText preset="body" as="p">
                These calls take a panel id, and the daemon accepts only the caller's own:
            </PaperText>
            <PaperTextList>
                <li><PaperLink href="/docs/paperapi/config/">configApi</PaperLink>, <PaperLink href="/docs/paperapi/secrets/">secretsApi</PaperLink> and <PaperLink href="/docs/paperapi/file/">fileApi</PaperLink></li>
                <li><PaperLink href="/docs/paperapi/ports/">portApi</PaperLink> and <PaperLink href="/docs/paperapi/backups/">backupsApi</PaperLink></li>
                <li><PaperLink href="/docs/paperapi/panels/">panelsApi</PaperLink> <PaperCode>restartService</PaperCode> and <PaperCode>uninstall</PaperCode></li>
                <li>Registering actions, firing events and triggers, with <PaperLink href="/docs/paperapi/actions/">actionsApi</PaperLink></li>
            </PaperTextList>
            <PaperText preset="body" as="p">
                Any other id is refused with <PaperCode>FORBIDDEN</PaperCode>:
            </PaperText>
            <PaperCode block language="text">
{`Cross-panel access refused: credential is scoped to "dev.example.weather"; access is limited to "dev.example.weather"`}
            </PaperCode>
            <PaperText preset="body" as="p">
                Processes and terminals belong to the panel that started them. Another panel can't write to, attach to or stop them, or start one with the same id: it gets <PaperCode>[process:run] "&lt;id&gt;" belongs to another panel</PaperCode> (<PaperCode>FORBIDDEN</PaperCode>). Ids are shared by every panel on the computer, so start them with the panel's name.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="shared">Shared between panels</PaperText>
            <PaperTextList>
                <li>Any panel can call any other panel's actions, except the ones its definition marks <PaperCode>internal</PaperCode>. An internal action called by another panel is refused with <PaperCode>Action "&lt;action&gt;" is internal to panel "&lt;panel&gt;"</PaperCode> (<PaperCode>FORBIDDEN</PaperCode>).</li>
                <li>Any panel can listen to any panel's events and triggers.</li>
                <li>Any panel can list the installed panels and the registry, and read the computer's details with <PaperLink href="/docs/paperapi/system/">systemApi</PaperLink>.</li>
                <li>Packages from <PaperLink href="/docs/paperapi/package/">packageApi</PaperLink> are installed once per computer, for every panel.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="host-only">Paperboard only</PaperText>
            <PaperText preset="body" as="p">
                Some calls change the computer for every panel, and only Paperboard itself can make them.
                A panel's call is refused with <PaperCode>&lt;operation&gt; is host-only; credential is scoped to "&lt;panel&gt;"</PaperCode> (<PaperCode>FORBIDDEN</PaperCode>):
            </PaperText>
            <PaperTextList>
                <li>Installing panels, with <PaperCode>panelsApi.install</PaperCode>.</li>
                <li>Every claim and the taken-port policy, with <PaperCode>portSettingsApi</PaperCode>.</li>
                <li>Backup locations: listing, adding, removing and reconnecting them, their space, and the location each panel uses.</li>
                <li>Per-panel usage, with <PaperCode>systemApi.getUsage</PaperCode>.</li>
                <li>Downgrading a package.</li>
                <li>Pairing computers, updating the daemon, issuing credentials and watching traffic.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="media">Microphone, camera and screen</PaperText>
            <PaperText preset="body" as="p">
                A panel page uses the microphone, camera and screen through the standard web APIs, with no Paperboard import.
                The first time a panel asks, Paperboard asks the person whether that panel may, and keeps the answer.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Permission</th>
                        <th>Web API</th>
                        <th>Behavior</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>Microphone</td>
                        <td><PaperCode>getUserMedia({"{ audio: true }"})</PaperCode></td>
                        <td>Audio input.</td>
                    </tr>
                    <tr>
                        <td>Camera</td>
                        <td><PaperCode>getUserMedia({"{ video: true }"})</PaperCode></td>
                        <td>Video input. Asking for audio and video together is one question.</td>
                    </tr>
                    <tr>
                        <td>Screen</td>
                        <td><PaperCode>getDisplayMedia({"{ video: true }"})</PaperCode></td>
                        <td>A screen or window the person picks on every call. Where the system has its own picker, such as Linux on Wayland, that picker chooses.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperTextList>
                <li>The call waits while the person answers, then resolves with the stream, or rejects with <PaperCode>NotAllowedError</PaperCode>.</li>
                <li>A refused panel isn't asked again: its requests reject at once until the person changes the answer in App Settings, under Panel permissions.</li>
                <li>Closing the question without answering refuses that one request, and the next one asks again.</li>
                <li>Answers are kept per panel id by the Paperboard app on the device showing the panel, so the same panel from different computers shares one answer.</li>
                <li>On macOS and Windows, the system also decides whether Paperboard may use the device. When it refuses, Paperboard tells the person and offers the system's settings, and the request rejects with <PaperCode>NotAllowedError</PaperCode>.</li>
                <li>The clipboard is not a permission: every panel page can read and write it without a question.</li>
                <li>These apply to a panel's page. A widget can't use the microphone, camera or screen.</li>
            </PaperTextList>
            <PaperCode block language="tsx">
{`try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    startRecording(stream);
} catch (err) {
    if ((err as Error).name === "NotAllowedError") {
        setError("Recording needs the microphone. Allow it in App Settings, under Panel permissions.");
    } else {
        setError(\`The microphone isn't available: \${(err as Error).message}\`);
    }
}

// when done, so the device turns off
for (const track of stream.getTracks()) track.stop();`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="page-policy">Page policy</PaperText>
            <PaperText preset="body" as="p">
                Every panel page and widget is served with the same content security policy:
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Content</th>
                        <th>Allowed from</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td>Scripts</td><td>The panel's own files. Inline scripts and scripts from the internet are blocked.</td></tr>
                    <tr><td>Styles</td><td>The panel's own files and inline styles.</td></tr>
                    <tr><td>Network requests</td><td>The panel, any <PaperCode>https:</PaperCode> address, and <PaperCode>http</PaperCode> and <PaperCode>ws</PaperCode> on <PaperCode>127.0.0.1</PaperCode> and <PaperCode>localhost</PaperCode> on any port.</td></tr>
                    <tr><td>Images</td><td>The panel, other panels, any <PaperCode>https:</PaperCode> address, <PaperCode>data:</PaperCode> and <PaperCode>blob:</PaperCode>.</td></tr>
                    <tr><td>Fonts</td><td>The panel and <PaperCode>data:</PaperCode>.</td></tr>
                    <tr><td>Audio and video</td><td>The panel and <PaperCode>blob:</PaperCode>.</td></tr>
                    <tr><td>Frames</td><td>The panel, and <PaperCode>http</PaperCode> on <PaperCode>127.0.0.1</PaperCode>, <PaperCode>localhost</PaperCode> and <PaperCode>*.localhost</PaperCode> on any port. No internet page.</td></tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                The frame around the page allows scripts, forms and pop-ups. It has no <PaperCode>allow-modals</PaperCode> and no <PaperCode>allow-downloads</PaperCode>, so <PaperCode>alert</PaperCode>, <PaperCode>confirm</PaperCode> and <PaperCode>prompt</PaperCode> do nothing and downloads are blocked.
                Ask with a PaperUI dialog, and save files with <PaperLink href="/docs/paperapi/file/#export-and-import">fileApi</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="local-pages">Local pages</PaperText>
            <PaperText preset="body" as="p">
                A panel can show a web page its own program serves on loopback, in a frame.
                The page decides who may frame it. To let only Paperboard show it, send this header, which names the app, its panels, its development shell and browser mode:
            </PaperText>
            <PaperCode block language="text">
{`Content-Security-Policy: frame-ancestors paperboard: panel: http://localhost:* http://paperboard.localhost:* http://*.paperboard.localhost:*`}
            </PaperCode>
            <PaperText preset="body" as="p">
                Loopback is the device showing the panel. A panel shown from another computer can't reach its program's loopback, so check <PaperLink href="/docs/paperapi/connection/#api">grantedComputerId()</PaperLink> and tell the person when it isn't <PaperCode>"local"</PaperCode>.
            </PaperText>
        </PaperFlex>
    );
}
