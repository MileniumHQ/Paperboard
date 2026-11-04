import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function AnatomyDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">Anatomy of a panel</PaperText>
            <PaperText preset="body" as="p">
                A panel folder holds a manifest, the source of up to three programs, and the build Paperboard runs.
                Here is what each file of a new panel does, what Paperboard reads, and where the panel's data lives instead.
                Keep it open beside the folder from <PaperLink href="/docs/guides/first-panel/">Your first panel</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="before-you-start">Before you start</PaperText>
            <PaperText preset="body" as="p">
                Make a panel with <PaperCode>npm create @mileniumhq/panel</PaperCode> and keep every choice, as in <PaperLink href="/docs/guides/first-panel/">Your first panel</PaperLink>.
                A choice you leave out removes its files and its manifest entries.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="three-programs">Three programs, one folder</PaperText>
            <PaperText preset="body" as="p">
                A panel is up to three programs that share code. Each one connects to the Paperboard server daemon on its own and can call PaperAPI.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Program</th>
                        <th>Source</th>
                        <th>Built to</th>
                        <th>Runs</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>Panel page</td>
                        <td><PaperCode>index.html</PaperCode>, <PaperCode>src/index.tsx</PaperCode></td>
                        <td><PaperCode>dist/index.html</PaperCode></td>
                        <td>In a frame of the Paperboard window, while the panel is open.</td>
                    </tr>
                    <tr>
                        <td>Service</td>
                        <td><PaperCode>src/service.ts</PaperCode></td>
                        <td><PaperCode>dist/service.js</PaperCode></td>
                        <td>As a background process of the Paperboard server daemon, with or without a window open. The daemon restarts it when it crashes.</td>
                    </tr>
                    <tr>
                        <td>Widget page</td>
                        <td><PaperCode>widget.html</PaperCode>, <PaperCode>src/widget.tsx</PaperCode></td>
                        <td><PaperCode>dist/widget.html</PaperCode></td>
                        <td>In one frame per widget placed on Home.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                The pages get their connection from Paperboard when it serves them. The service gets it from the environment the daemon starts it with.
                <PaperLink href="/docs/paperapi/overview/#contexts">Where code runs</PaperLink> has the details.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="files">The files</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>File</th>
                        <th>What it does</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>manifest.json</PaperCode></td><td>The panel's id, name, version, and where its page, service and widgets are. See <PaperLink href="/docs/guides/anatomy/#manifest">The manifest</PaperLink>.</td></tr>
                    <tr><td><PaperCode>package.json</PaperCode></td><td>Dependencies and the scripts below.</td></tr>
                    <tr><td><PaperCode>vite.config.ts</PaperCode></td><td>Builds the two pages side by side: <PaperCode>{"input: { index: \"index.html\", widget: \"widget.html\" }"}</PaperCode>.</td></tr>
                    <tr><td><PaperCode>tsconfig.json</PaperCode></td><td>Strict TypeScript with Solid's JSX. <PaperCode>bun run build</PaperCode> runs <PaperCode>tsc</PaperCode> first, so a type error stops the build.</td></tr>
                    <tr><td><PaperCode>bunfig.toml</PaperCode></td><td>Loads <PaperCode>test/hermetic.ts</PaperCode> before every test run.</td></tr>
                    <tr><td><PaperCode>index.html</PaperCode></td><td>The panel page. Its mount element has the id <PaperCode>app</PaperCode>, which PaperUI's <PaperCode>panel.css</PaperCode> sizes to the frame.</td></tr>
                    <tr><td><PaperCode>widget.html</PaperCode></td><td>The page every widget of the panel shares.</td></tr>
                    <tr><td><PaperCode>src/panel.ts</PaperCode></td><td>What all three programs agree on: <PaperCode>PANEL_ID</PaperCode>, the state's type and its starting value. It imports nothing, so it runs in the browser and in Node.</td></tr>
                    <tr><td><PaperCode>src/index.tsx</PaperCode></td><td>Renders <PaperCode>App</PaperCode> inside <PaperLink href="/docs/paperui/paperprovider/">PaperProvider</PaperLink>, which every PaperUI page needs at its root.</td></tr>
                    <tr><td><PaperCode>src/App.tsx</PaperCode></td><td>The menu and the page it picked, laid out by <PaperLink href="/docs/paperui/paperpanel/">PaperPanel</PaperLink>. It imports PaperUI's two stylesheets.</td></tr>
                    <tr><td><PaperCode>src/pages/</PaperCode></td><td>One file per page. <PaperCode>CounterPage</PaperCode> keeps state in the window, <PaperCode>NotesPage</PaperCode> in the panel's config, <PaperCode>ServicePage</PaperCode> in the service.</td></tr>
                    <tr><td><PaperCode>src/service.ts</PaperCode></td><td>The service: its state, its actions and its start-up work, through <PaperLink href="/docs/paperapi/service/">definePanelService</PaperLink>.</td></tr>
                    <tr><td><PaperCode>src/widget.tsx</PaperCode></td><td>The widget page's mount functions, through <PaperLink href="/docs/paperapi/widgets/">defineWidgets</PaperLink>.</td></tr>
                    <tr><td><PaperCode>src/widget.css</PaperCode></td><td>Gives the widget page a full-height, painted body.</td></tr>
                    <tr><td><PaperCode>src/lib/</PaperCode></td><td>Logic with no PaperAPI and no interface in it, such as <PaperCode>greet.ts</PaperCode>. Code here is what the unit tests reach. <PaperCode>failure.ts</PaperCode> turns a caught error into the words a person is shown.</td></tr>
                    <tr><td><PaperCode>test/</PaperCode></td><td>Unit tests, the UI standards test, and <PaperCode>hermetic.ts</PaperCode>, which keeps tests away from your real Paperboard. See <PaperLink href="/docs/guides/testing/">Test a panel</PaperLink>.</td></tr>
                    <tr><td><PaperCode>store/about.md</PaperCode></td><td>The long description on the panel's page in the Panel Library. See <PaperLink href="/docs/paperapi/store-listing/">Store listing</PaperLink>.</td></tr>
                    <tr><td><PaperCode>.gitignore</PaperCode></td><td>Keeps <PaperCode>node_modules/</PaperCode>, <PaperCode>dist/</PaperCode> and the release folder <PaperCode>out/</PaperCode> out of version control.</td></tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="scripts">The scripts</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Script</th>
                        <th>What it runs</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>bun run build</PaperCode></td><td><PaperCode>tsc</PaperCode>, then <PaperCode>vite build</PaperCode> for the pages, then <PaperCode>bun build ./src/service.ts --outfile ./dist/service.js --target=node</PaperCode> for the service. A panel without a service runs only the first two.</td></tr>
                    <tr><td><PaperCode>bun test</PaperCode></td><td>Every <PaperCode>*.test.ts</PaperCode> file, after <PaperCode>test/hermetic.ts</PaperCode>.</td></tr>
                    <tr><td><PaperCode>bun run pack</PaperCode></td><td><PaperCode>bunx paperapi pack</PaperCode>, which writes the release archive. See <PaperLink href="/docs/guides/packaging/">Package a panel</PaperLink>.</td></tr>
                    <tr><td><PaperCode>bun run dev</PaperCode>, <PaperCode>bun run preview</PaperCode></td><td>Vite's own web server. Paperboard does not use it: Paperboard runs what <PaperCode>build</PaperCode> writes.</td></tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                The service is built for Node because the daemon runs it with Node, Bun, or the Bun inside the released daemon. Write service code that runs on both.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="manifest">The manifest</PaperText>
            <PaperCode block language="json">
{`{
    "name": "Hello",
    "id": "dev.example.hello",
    "version": "0.1.0",
    "description": "Says hello to people by name",
    "base": "./dist/index.html",
    "service": "./dist/service.js",
    "widgets": [
        {
            "id": "greetings",
            "name": "Greetings",
            "description": "How many greetings the service has given",
            "sizes": ["1x1", "2x1"]
        }
    ],
    "store": {
        "about": "./store/about.md"
    },
    "publisher": "Ada Lovelace"
}`}
            </PaperCode>
            <PaperTextList>
                <li><PaperCode>id</PaperCode> must match the folder name Paperboard finds it under. <PaperCode>paperapi link</PaperCode> names the link after it.</li>
                <li><PaperCode>base</PaperCode> and <PaperCode>service</PaperCode> point into <PaperCode>dist/</PaperCode>, because the release archive ships <PaperCode>dist/</PaperCode> and not <PaperCode>src/</PaperCode>.</li>
                <li>A manifest the daemon refuses keeps the panel out of the list with no message in Paperboard. Run <PaperCode>bunx paperapi doctor</PaperCode> to see why.</li>
                <li>Before a release, add <PaperCode>branding/icon.png</PaperCode> and set <PaperCode>{"\"icon\": \"./branding/icon.png\""}</PaperCode>. Until then the panel shows a generic icon.</li>
            </PaperTextList>
            <PaperText preset="body" as="p">
                Every field and its limits are on <PaperLink href="/docs/paperapi/manifest/">manifest.json</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="panel-id">Pass the panel id</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>src/panel.ts</PaperCode> exports <PaperCode>PANEL_ID</PaperCode>, and every PaperAPI call that takes a panel id gets it: <PaperCode>configApi.get(PANEL_ID)</PaperCode>, <PaperCode>{"createPanelBridge({ panelId: PANEL_ID })"}</PaperCode>, <PaperCode>{"definePanelService({ id: PANEL_ID })"}</PaperCode>.
                Without it, PaperAPI works the id out from where the code runs. Passing it keeps every call pointed at this panel, wherever the code ends up.
            </PaperText>
            <PaperCode block language="tsx">
{`export const PANEL_ID = "dev.example.hello";

export interface PanelState {
    greetingCount: number;
}

export const DEFAULT_STATE: PanelState = { greetingCount: 0 };`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="data">Where the panel's data lives</PaperText>
            <PaperText preset="body" as="p">
                Nothing a person saves goes in the panel folder. Paperboard keeps it in its data folder, filed under the panel id, so it survives an update, a relink and an uninstall:
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Data</th>
                        <th>API</th>
                        <th>Stored in the data folder at</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td>Settings and small JSON documents</td><td><PaperLink href="/docs/paperapi/config/">configApi</PaperLink></td><td><PaperCode>configs/&lt;id&gt;.json</PaperCode>, and <PaperCode>files/&lt;id&gt;/</PaperCode> for named documents</td></tr>
                    <tr><td>Files</td><td><PaperLink href="/docs/paperapi/file/">fileApi</PaperLink></td><td><PaperCode>files/&lt;id&gt;/</PaperCode></td></tr>
                    <tr><td>API keys, tokens, passwords</td><td><PaperLink href="/docs/paperapi/secrets/">secretsApi</PaperLink></td><td><PaperCode>local/secrets.json</PaperCode></td></tr>
                    <tr><td>The service's state</td><td><PaperLink href="/docs/paperapi/service/">definePanelService</PaperLink></td><td>Nowhere: it lives in memory and starts again from <PaperCode>state</PaperCode> on every service start</td></tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                The data folder is <PaperCode>~/.paperboard</PaperCode>, or <PaperCode>PAPERBOARD_DIR</PaperCode> when it is set. Read and write it through the APIs, never by path.
                Linking a panel only adds <PaperCode>panels/&lt;id&gt;</PaperCode>, a link to your folder.
            </PaperText>

            <PaperText preset="body" as="p">
                Next: <PaperLink href="/docs/guides/dev-loop/">the development loop</PaperLink>.
            </PaperText>
        </PaperFlex>
    );
}
