import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

const MANIFEST = `{
    "name": "Weather",
    "id": "dev.example.weather",
    "version": "0.2.0",
    "description": "Today's weather for the cities you follow",
    "icon": "./branding/icon.png",
    "base": "./dist/index.html",
    "service": "./dist/service.js",
    "widgets": [
        {
            "id": "forecast",
            "name": "Forecast",
            "description": "The temperature in one city you follow",
            "sizes": [
                "2x1"
            ],
            "options": [
                {
                    "id": "city",
                    "label": "City"
                }
            ]
        }
    ],
    "store": {
        "about": "./store/about.md"
    },
    "publisher": "Ada Lovelace"
}`;

export default function PackagingGuideDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">Package a panel</PaperText>
            <PaperText preset="body" as="p">
                A release of a panel is one archive: its manifest, its built files and its icon.
                This guide gives the Weather example panel an icon and a version, packs it, and installs the archive on another computer by hand.
                The same archive is what the Paperboard team reviews when the panel goes to the Panel Library.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="before-you-start">Before you start</PaperText>
            <PaperText preset="body" as="p">
                A panel that passes its tests and the <PaperLink href="/docs/guides/checklist/">panel checklist</PaperLink>.
                The packer's rules are in the <PaperLink href="/docs/paperapi/cli/#pack">paperapi pack</PaperLink> reference.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="icon">Give it an icon</PaperText>
            <PaperText preset="body" as="p">
                Paperboard shows the icon in the panel list, and the Actions panel shows it on every block of the panel's actions.
                A panel without one gets a stand-in in the list and a broken image on its blocks.
                Save a square PNG as <PaperCode>branding/icon.png</PaperCode> and name it in the manifest:
            </PaperText>
            <PaperCode block language="json">{MANIFEST}</PaperCode>
            <PaperText preset="body" as="p">
                The packer ships <PaperCode>branding/</PaperCode>, or <PaperCode>icon.png</PaperCode> at the panel root when there is no <PaperCode>branding/</PaperCode> folder. An icon anywhere else is left out of the archive.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="version">Set the version</PaperText>
            <PaperTextList>
                <li><PaperCode>version</PaperCode> in <PaperCode>manifest.json</PaperCode> is the panel's version. <PaperCode>package.json</PaperCode> has none, and Paperboard never reads it.</li>
                <li>Raise it for every release: <PaperCode>0.1.0</PaperCode>, then <PaperCode>0.2.0</PaperCode>. A backup made by a newer version than the one installed is refused, so the number has to go up.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="pack">Pack it</PaperText>
            <PaperCode block language="sh">
{`$ bunx paperapi pack
Archiving manifest.json, dist, branding...
✓ Packed dev.example.weather 0.2.0 · 996.8 KB
out/dev.example.weather-0.2.0.tar.gz
sha256 aafa8802d83c160b9cd81a93693ea79f3ae1d4a29410b559e3902cc7b5158ca1`}
            </PaperCode>
            <PaperText preset="body" as="p">
                The scaffold's <PaperCode>bun run pack</PaperCode> runs the same command. The archive goes to <PaperCode>out/</PaperCode>, which the scaffold's <PaperCode>.gitignore</PaperCode> keeps out of the repository.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>In the archive</th>
                        <th>Left out</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>manifest.json</PaperCode>, <PaperCode>dist/</PaperCode>, <PaperCode>branding/</PaperCode></td>
                        <td><PaperCode>src/</PaperCode>, <PaperCode>test/</PaperCode>, <PaperCode>store/</PaperCode>, <PaperCode>node_modules/</PaperCode>, and everything else</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperTextList>
                <li>The service runs from the archive alone, with no <PaperCode>node_modules/</PaperCode>. The scaffold's build bundles <PaperCode>@mileniumhq/paperapi</PaperCode> and every other import into <PaperCode>dist/service.js</PaperCode>. Keep it that way: a service that needs a package at run time fails on every computer but yours.</li>
                <li>The packer checks the manifest and the widgets with the rules Paperboard uses, and builds the panel first when <PaperCode>dist/index.html</PaperCode> is missing. It does not rebuild otherwise, so run <PaperCode>bun run build</PaperCode> before you pack.</li>
                <li><PaperCode>--json</PaperCode> prints the id, version, archive path, size and sha256 as one object, for a release script.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="install-by-hand">Install it on your computers</PaperText>
            <PaperText preset="body" as="p">
                A panel that is not in the Panel Library runs on your own computers from its archive.
                Unpack it into the <PaperCode>panels</PaperCode> folder of that computer's Paperboard data folder, in a folder named after the panel id, then restart its service:
            </PaperText>
            <PaperCode block language="sh">
{`mkdir -p ~/.paperboard/panels/dev.example.weather
tar -xzf dev.example.weather-0.2.0.tar.gz -C ~/.paperboard/panels/dev.example.weather`}
            </PaperCode>
            <PaperTextList>
                <li>Paperboard lists the panel at once. Start its service by right-clicking the panel in the list and choosing Restart Panel, or with <PaperCode>bunx paperapi restart dev.example.weather</PaperCode> from a panel folder on that computer. It also starts the next time that computer's Paperboard starts.</li>
                <li>On a computer whose Paperboard keeps its data elsewhere, such as a server daemon started with <PaperCode>--data-dir</PaperCode>, use that folder in place of <PaperCode>~/.paperboard</PaperCode>.</li>
                <li>To update it, uninstall the panel in Paperboard with its data kept, unpack the new archive the same way, and start it. Its config, files and secrets live outside the panel folder and stay. Never replace the files of a panel whose service is running.</li>
                <li>On the computer you develop on, <PaperCode>bunx paperapi link</PaperCode> refuses while an installed copy exists. <PaperCode>bunx paperapi link --force</PaperCode> replaces the installed copy's code with the link, and keeps its data.</li>
            </PaperTextList>
            <PaperText preset="body" as="p">
                A panel installed by hand has had no review. Install only archives you built or whose source you have read: a panel runs with the full reach of the account running Paperboard.
            </PaperText>

            <PaperText preset="body" as="p">
                Next: <PaperLink href="/docs/guides/panel-library/">get into the Panel Library</PaperLink>.
            </PaperText>
        </PaperFlex>
    );
}
