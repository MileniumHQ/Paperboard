import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function GuidesOverviewDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">Build a panel</PaperText>
            <PaperText preset="body" as="p">
                These guides take a panel from an empty folder to the Panel Library, one working step at a time.
                A panel is a folder Paperboard runs: a manifest, a page built with PaperUI, and often a background service that talks to Paperboard through PaperAPI.
                Read them in order the first time, then come back to the page for the part you are building.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="before-you-start">Before you start</PaperText>
            <PaperTextList>
                <li>Paperboard installed and running on this computer. See <PaperLink href="/docs/paperboard/install/">Install Paperboard</PaperLink>.</li>
                <li><PaperLink href="https://bun.sh">Bun</PaperLink>. Panels install, build and test with it.</li>
                <li>Node.js with npm, for <PaperCode>npm create</PaperCode>, which makes the panel folder.</li>
                <li>Some TypeScript. Panel pages use SolidJS, and the samples explain the Solid parts they use.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="what-a-panel-is">What a panel is made of</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Part</th>
                        <th>What it does</th>
                        <th>Where to read more</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>manifest.json</PaperCode></td>
                        <td>Names the panel and points Paperboard at its page, service and widgets.</td>
                        <td><PaperLink href="/docs/paperapi/manifest/">manifest.json</PaperLink></td>
                    </tr>
                    <tr>
                        <td>Panel page</td>
                        <td>The interface, shown in the Paperboard window. Built from PaperUI components.</td>
                        <td><PaperLink href="/docs/developers/ui/">Design the interface</PaperLink></td>
                    </tr>
                    <tr>
                        <td>Service</td>
                        <td>A background program the Paperboard server daemon keeps running, with or without a window open. It holds the panel's state and offers its actions.</td>
                        <td><PaperLink href="/docs/developers/services/">Services and state</PaperLink></td>
                    </tr>
                    <tr>
                        <td>Widget page</td>
                        <td>Small live tiles people place on Home.</td>
                        <td><PaperLink href="/docs/developers/widgets/">Add a Home widget</PaperLink></td>
                    </tr>
                    <tr>
                        <td>Actions</td>
                        <td>What the panel offers to other panels, to flows in the Actions panel, and to agents.</td>
                        <td><PaperLink href="/docs/developers/actions/">Expose actions</PaperLink></td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                Only the manifest and the page are required. A panel that only shows something needs no service.
                A panel that runs a server, a bot, or anything on a schedule needs one.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="trust">Panels run with full trust</PaperText>
            <PaperText preset="body" as="p">
                Paperboard does not sandbox panels. A panel can start any program on the computer, and its service is an ordinary Node or Bun program with the same reach as the account that runs Paperboard.
                What Paperboard enforces is ownership: a panel reads and writes only its own config, files, secrets, ports and processes.
                <PaperLink href="/docs/paperapi/permissions/">Permissions</PaperLink> lists exactly what a panel can and cannot do.
                This is why every panel in the Panel Library is reviewed by the Paperboard team before it ships. See <PaperLink href="/docs/developers/panel-library/">Get into the Panel Library</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="house-rules">What a good panel does</PaperText>
            <PaperText preset="body" as="p">
                The first-party panels follow the same rules, and the review checks them. Each guide shows how in its own part of the panel.
            </PaperText>
            <PaperTextList>
                <li>It is built from PaperUI components and props, with no inline styles. A design token that no prop takes is read with <PaperCode>getVarCss()</PaperCode>.</li>
                <li>It shows every failure, with the real reason, where the person was looking. Nothing fails silently.</li>
                <li>It never shows a placeholder in place of something missing. A missing thing is an error, said as one.</li>
                <li>It keeps API keys, tokens and passwords in <PaperCode>secretsApi</PaperCode>, never in config or files.</li>
                <li>It keeps the user's data when it is removed, unless they ask for it to be deleted.</li>
                <li>Its tests never reach the real Paperboard data folder.</li>
                <li>It works the same for every person and every computer: no code paths for one setup.</li>
            </PaperTextList>
            <PaperText preset="body" as="p">
                The whole list is the <PaperLink href="/docs/developers/checklist/">panel checklist</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="the-guides">The guides</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Guide</th>
                        <th>What you do</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperLink href="/docs/developers/first-panel/">Your first panel</PaperLink></td><td>Make a panel, run it in Paperboard, and add an action to it.</td></tr>
                    <tr><td><PaperLink href="/docs/developers/anatomy/">Anatomy of a panel</PaperLink></td><td>Learn what each file in the panel folder does.</td></tr>
                    <tr><td><PaperLink href="/docs/developers/dev-loop/">The development loop</PaperLink></td><td>Build, restart, call and watch a panel while you work.</td></tr>
                    <tr><td><PaperLink href="/docs/developers/services/">Services and state</PaperLink></td><td>Keep state in a service and mirror it in every window.</td></tr>
                    <tr><td><PaperLink href="/docs/developers/ui/">Design the interface</PaperLink></td><td>Lay out pages with PaperUI.</td></tr>
                    <tr><td><PaperLink href="/docs/developers/errors/">Show every failure</PaperLink></td><td>Throw failures with reasons and show them.</td></tr>
                    <tr><td><PaperLink href="/docs/developers/settings-and-secrets/">Settings and secrets</PaperLink></td><td>Save settings, and keep keys out of them.</td></tr>
                    <tr><td><PaperLink href="/docs/developers/actions/">Expose actions</PaperLink></td><td>Offer actions and triggers to flows and agents.</td></tr>
                    <tr><td><PaperLink href="/docs/developers/widgets/">Add a Home widget</PaperLink></td><td>Put one live fact on Home.</td></tr>
                    <tr><td><PaperLink href="/docs/developers/testing/">Test a panel</PaperLink></td><td>Unit tests, and tests against a real Paperboard.</td></tr>
                    <tr><td><PaperLink href="/docs/developers/checklist/">Panel checklist</PaperLink></td><td>Check the panel before you ship it.</td></tr>
                    <tr><td><PaperLink href="/docs/developers/packaging/">Package a panel</PaperLink></td><td>Make the release archive and run it on your computers.</td></tr>
                    <tr><td><PaperLink href="/docs/developers/panel-library/">Get into the Panel Library</PaperLink></td><td>Submit the panel to the Paperboard team.</td></tr>
                    <tr><td><PaperLink href="/docs/developers/agents/">Build with an agent</PaperLink></td><td>Hand these docs to a coding agent and check its work.</td></tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                The build guides follow one example panel, Weather, which checks the weather for the cities a person follows.
            </PaperText>

            <PaperText preset="body" as="p">
                Next: <PaperLink href="/docs/developers/first-panel/">make your first panel</PaperLink>.
            </PaperText>
        </PaperFlex>
    );
}
