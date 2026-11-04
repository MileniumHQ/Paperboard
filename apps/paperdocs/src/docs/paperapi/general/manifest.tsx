import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function ManifestDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">manifest.json</PaperText>
            <PaperText preset="body" as="p">
                manifest.json at the root of a panel folder tells Paperboard the panel's id, name, version, pages, service, widgets and tutorial.
                The Paperboard server daemon reads it to list the panel and start its service, and <PaperCode>paperapi pack</PaperCode> reads it to build the release.
                The <PaperCode>store</PaperCode> block describes the panel's page in the Panel Library.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                The smallest manifest that packs and runs, for a panel without a service:
            </PaperText>
            <PaperCode block language="json">
{`{
    "id": "dev.example.weather",
    "name": "Weather",
    "version": "1.0.0"
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="fields">Fields</PaperText>
            <PaperText preset="body" as="p">
                "Packer" is <PaperCode>paperapi pack</PaperCode>. "Daemon" is the Paperboard server daemon reading an installed or linked panel. A text field longer than its limit is cut to the limit by the daemon.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Field</th>
                        <th>Type</th>
                        <th>Required</th>
                        <th>What Paperboard does with it</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>id</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>Packer: yes. Daemon: no, the folder name is used.</td>
                        <td>The panel's identity everywhere: its folder, its storage, its credential, its actions. See <PaperLink href="/docs/paperapi/manifest/#panel-id">Panel id</PaperLink>. The daemon refuses a manifest whose id differs from its folder name.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>name</PaperCode></td>
                        <td><PaperCode>string</PaperCode>, up to 128</td>
                        <td>Packer: yes</td>
                        <td>The name in the sidebar, the tab and the Panel Library. Without it, the daemon uses <PaperCode>title</PaperCode>, then the id.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>version</PaperCode></td>
                        <td><PaperCode>string</PaperCode>, up to 32</td>
                        <td>Packer: yes</td>
                        <td>Names the archive <PaperCode>&lt;id&gt;-&lt;version&gt;.tar.gz</PaperCode>. An install from the registry refuses an archive whose version differs from the one the registry lists. Backups record it, and a restore refuses a backup from a newer version.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>description</PaperCode></td>
                        <td><PaperCode>string</PaperCode>, up to 2048</td>
                        <td>No</td>
                        <td>The line under the name in the Panel Library.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>publisher</PaperCode></td>
                        <td><PaperCode>string</PaperCode>, up to 128</td>
                        <td>No</td>
                        <td>Who makes the panel, shown in the Panel Library. Without it, the daemon uses <PaperCode>author</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>icon</PaperCode></td>
                        <td><PaperCode>string</PaperCode>, up to 256</td>
                        <td>No</td>
                        <td>A path to the icon image, relative to the panel folder, loaded from the panel's own origin. The packer ships <PaperCode>branding/</PaperCode>, or <PaperCode>icon.png</PaperCode> when there is no <PaperCode>branding/</PaperCode>, so keep the icon in one of those or in <PaperCode>dist/</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>base</PaperCode></td>
                        <td><PaperCode>string</PaperCode>, up to 256</td>
                        <td>No. Default <PaperCode>./dist/index.html</PaperCode>.</td>
                        <td>The packer builds when this file is missing and archives the folder holding it. Relative, with no <PaperCode>..</PaperCode>. The shell always opens <PaperCode>index.html</PaperCode> at the panel's root, served from <PaperCode>dist/index.html</PaperCode> when it exists, so keep the entry page there.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>service</PaperCode></td>
                        <td><PaperCode>string</PaperCode>, up to 256</td>
                        <td>No</td>
                        <td>The service script, relative to the panel folder, with no <PaperCode>..</PaperCode>. The daemon runs it with the panel folder as working directory. Without it, the panel has no service. Build it into <PaperCode>dist/</PaperCode>: the packer ships nothing outside the folders listed under <PaperCode>icon</PaperCode> and <PaperCode>base</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>autostart</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No. Default <PaperCode>true</PaperCode>.</td>
                        <td><PaperCode>false</PaperCode> keeps the service from starting when the daemon starts. It still starts after an install and on a restart. Any value other than a boolean is ignored.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>widgets</PaperCode></td>
                        <td><PaperCode>WidgetDeclaration[]</PaperCode></td>
                        <td>No</td>
                        <td>Up to 8 widgets the panel offers for Home. See <PaperLink href="/docs/paperapi/widgets/">Widgets</PaperLink>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>tutorial</PaperCode></td>
                        <td><PaperCode>TutorialStep[]</PaperCode></td>
                        <td>No</td>
                        <td>1 to 6 pages the shell shows the first time someone opens the panel. See <PaperLink href="/docs/paperapi/tutorials/">Tutorials</PaperLink>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>store</PaperCode></td>
                        <td><PaperCode>object</PaperCode></td>
                        <td>No</td>
                        <td>The panel's page in the Panel Library, read when the panel is published. See <PaperLink href="/docs/paperapi/store-listing/">Store listing</PaperLink>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>unlisted</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No. Default <PaperCode>false</PaperCode>.</td>
                        <td>Read when the panel is published. <PaperCode>true</PaperCode> keeps the panel out of the Panel Library. The packer refuses any value other than a boolean.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                The daemon drops every other field. There is no permissions or network field: a panel's reach is fixed, and is described on <PaperLink href="/docs/paperapi/permissions/">Permissions</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="panel-id">Panel id</PaperText>
            <PaperTextList>
                <li>Lowercase letters, digits, <PaperCode>_</PaperCode> and <PaperCode>-</PaperCode>, in dot-separated parts that each start with a letter or digit: <PaperCode>{"^[a-z0-9][a-z0-9_-]*(?:\\.[a-z0-9][a-z0-9_-]*)*$"}</PaperCode>.</li>
                <li>At most 128 characters.</li>
                <li>Not one of <PaperCode>library</PaperCode>, <PaperCode>settings</PaperCode>, <PaperCode>landing</PaperCode>, <PaperCode>app-settings</PaperCode>, <PaperCode>crane_version</PaperCode>, <PaperCode>default</PaperCode>, and not starting with <PaperCode>shell-</PaperCode>. Paperboard keeps those for itself.</li>
                <li>Use reverse DNS for a name you control, as the first-party panels do: <PaperCode>dev.paperboard.terminal</PaperCode>.</li>
            </PaperTextList>
            <PaperText preset="body" as="p">
                Never change a released panel's id. Its config, files, secrets, backups and ports are all filed under it.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="validation">Validation errors</PaperText>
            <PaperText preset="body" as="p">
                The daemon refuses the whole manifest on any of these. The panel is then left out of the panel list and its service does not start.
                Paperboard shows no message for it, so run <PaperCode>paperapi doctor</PaperCode> in the panel folder to see the reason.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Error</th>
                        <th>Cause</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>Invalid panel manifest: expected object</PaperCode></td><td>The file holds an array, a string, or <PaperCode>null</PaperCode>.</td></tr>
                    <tr><td><PaperCode>Invalid panel id: use a lowercase identifier ...</PaperCode></td><td><PaperCode>id</PaperCode> breaks the panel id rule.</td></tr>
                    <tr><td><PaperCode>{"Manifest id \"<id>\" does not match requested panel id \"<folder>\""}</PaperCode></td><td>The folder in <PaperCode>panels/</PaperCode> has another name than <PaperCode>id</PaperCode>.</td></tr>
                    <tr><td><PaperCode>Invalid base path in manifest for &lt;id&gt;</PaperCode></td><td><PaperCode>base</PaperCode> is absolute or contains <PaperCode>..</PaperCode>.</td></tr>
                    <tr><td><PaperCode>Invalid service path in manifest for &lt;id&gt;</PaperCode></td><td><PaperCode>service</PaperCode> is absolute or contains <PaperCode>..</PaperCode>.</td></tr>
                    <tr><td><PaperCode>Invalid widgets in manifest for &lt;id&gt;: &lt;reason&gt;</PaperCode></td><td>A widget breaks a rule on <PaperLink href="/docs/paperapi/widgets/">Widgets</PaperLink>.</td></tr>
                    <tr><td><PaperCode>Invalid tutorial in manifest for &lt;id&gt;: &lt;reason&gt;</PaperCode></td><td>A step breaks a rule on <PaperLink href="/docs/paperapi/tutorials/">Tutorials</PaperLink>.</td></tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                When the service starts, a <PaperCode>service</PaperCode> path that is not a file fails with <PaperCode>Service entry is not a file: &lt;id&gt;</PaperCode>.
                The packer refuses a missing <PaperCode>name</PaperCode> (<PaperCode>Panel manifest must specify a 'name'</PaperCode>), a missing <PaperCode>version</PaperCode>, and a non-boolean <PaperCode>unlisted</PaperCode>.
                <PaperCode>paperapi doctor</PaperCode> runs the same checks and reports them all at once.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="folder">Folder layout</PaperText>
            <PaperCode block language="text">
{`manifest.json
branding/icon.png       the icon, shipped in the archive
dist/index.html         the panel page
dist/widget.html        the widget page, when the panel has widgets
dist/service.js         the service, when the panel has one
dist/tutorial/          tutorial images
store/                  Panel Library media, never shipped in the archive
src/                    your source, never shipped`}
            </PaperCode>
            <PaperText preset="body" as="p">
                Paperboard serves the panel's origin from <PaperCode>dist/</PaperCode> first, then from the panel folder. A request for <PaperCode>branding/icon.png</PaperCode> returns <PaperCode>dist/branding/icon.png</PaperCode> when it exists.
                No path may leave the panel folder, and nothing below it may be a symbolic link.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="example">Example</PaperText>
            <PaperText preset="body" as="p">
                The Terminal panel's manifest, with a service, a widget, a tutorial and a store listing:
            </PaperText>
            <PaperCode block language="json">
{`{
    "name": "Terminal",
    "id": "dev.paperboard.terminal",
    "version": "0.3.2",
    "description": "Interactive shell & multi-tab terminal console",
    "publisher": "Paperboard",
    "base": "./dist/index.html",
    "service": "./dist/service.js",
    "icon": "./branding/icon.png",
    "widgets": [
        {
            "id": "pinned-command",
            "name": "Pinned command",
            "description": "Runs a saved command and shows how it last exited",
            "sizes": ["2x1"],
            "options": [{ "id": "command", "label": "Command" }]
        }
    ],
    "tutorial": [
        {"image": {"light": "./tutorial/1-light.webp", "dark": "./tutorial/1-dark.webp", "alt": "Three terminal tabs: system info, a git log and the weather"}, "title": "Tabs keep running", "body": "Each tab stays alive until you close it. Start a long job, switch panels or close the window, and it keeps going."},
        {"image": {"light": "./tutorial/2-light.webp", "dark": "./tutorial/2-dark.webp", "alt": "The Saved commands menu with Disk usage, Repo status, Weather and Update system"}, "title": "Save the commands you repeat", "body": "Save a command once and run it from the tab bar, or pin it to Home to run it in one click."},
        {"image": {"light": "./tutorial/3-light.webp", "dark": "./tutorial/3-dark.webp", "alt": "A weather forecast drawn in a terminal tab"}, "title": "Bring any tool", "body": "If it runs in a terminal it runs here, colors and all. Even the weather forecast."}
    ],
    "store": {
        "about": "./store/about.md",
        "screenshots": [
            { "light": "./store/1-light.png", "dark": "./store/1-dark.png", "alt": "System info at a glance" },
            { "light": "./store/2-light.png", "dark": "./store/2-dark.png", "alt": "Saved commands from the tab bar" },
            { "light": "./store/3-light.png", "dark": "./store/3-dark.png", "alt": "Work with git" },
            { "light": "./store/4-light.png", "dark": "./store/4-dark.png", "alt": "Any command-line tool" }
        ],
        "credits": [
            { "name": "xterm.js", "detail": "Rendering the terminal" }
        ]
    }
}`}
            </PaperCode>
            <PaperText preset="body" as="p">
                Next: <PaperLink href="/docs/paperapi/service/">write the service</PaperLink>.
            </PaperText>
        </PaperFlex>
    );
}
