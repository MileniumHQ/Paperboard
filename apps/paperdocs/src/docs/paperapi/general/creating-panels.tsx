import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperQuote,
    PaperTable,
    PaperText,
} from "@paperboard-dev/paperui";

export default function CreatingPanelsDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">Creating panels</PaperText>
            <PaperText preset="body">
                This guide covers panel scaffolding, manifest configuration, local symlink workflows, and registry review criteria.
                Reach for this guide when creating a new panel package for Paperboard.
                Panels combine an interactive SolidJS user interface with an optional daemon-supervised background service.
            </PaperText>

            <PaperText preset="subheader" id="scaffolding">Scaffolding a panel</PaperText>
            <PaperText preset="body">
                Generate a new panel project using the create-panel template.
                Pass your desired panel identifier and human-readable display name.
            </PaperText>
            <PaperCode block language="bash">
{`npm create @paperboard-dev/panel dev.paperboard.my-panel "My Panel"`}
            </PaperCode>
            <PaperText preset="body">
                If developing directly inside the Paperboard source repository, invoke the local script:
            </PaperText>
            <PaperCode block language="bash">
{`bun scripts/create-panel.ts dev.paperboard.my-panel "My Panel"`}
            </PaperCode>

            <PaperText preset="subheader" id="manifest-structure">Manifest structure</PaperText>
            <PaperText preset="body">
                Every panel project requires a manifest.json file at its root.
                The manifest defines the panel identifier, entry point bundles, metadata, and service entry point.
            </PaperText>
            <PaperCode block language="json">
{`{
  "name": "My Panel",
  "id": "dev.paperboard.my-panel",
  "version": "0.1.0",
  "description": "Example panel description",
  "publisher": "Developer",
  "base": "./dist/index.html",
  "service": "./dist/service.js",
  "icon": "./branding/icon.png",
  "store": {
    "about": "./store/about.md",
    "screenshots": [
      { "light": "./store/1-light.png", "dark": "./store/1-dark.png", "alt": "Chat view" }
    ],
    "services": [{ "name": "Ollama", "detail": "Downloading models" }],
    "credits": [{ "name": "Discord.js", "detail": "Providing the backend engine" }],
    "requirements": [{ "name": "RAM", "detail": "16 GB" }]
  }
}`}
            </PaperCode>

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
                        <td><PaperCode>id</PaperCode></td>
                        <td>string</td>
                        <td>Reverse-DNS lowercase identifier, matching [a-z0-9][a-z0-9_-]*(?:\\.[a-z0-9][a-z0-9_-]*)*.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>name</PaperCode></td>
                        <td>string</td>
                        <td>Human-readable display title shown in navigation and the library.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>version</PaperCode></td>
                        <td>string</td>
                        <td>Semantic version string. Use 0.x during active development.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>base</PaperCode></td>
                        <td>string</td>
                        <td>Relative path to the compiled HTML entry point.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>service</PaperCode></td>
                        <td>string</td>
                        <td>Relative path to the compiled background Node service script.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>store</PaperCode></td>
                        <td>object</td>
                        <td>Optional panel library page. See Store listing below.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" id="store-listing">Store listing</PaperText>
            <PaperText preset="body">
                The store block fills your panel's page in the panel library.
                Your name, description and publisher head the page, next to the install button.
                The block adds screenshots, a long description and three information cards.
                Every field is optional. A card with no rows is not shown.
            </PaperText>
            <PaperText preset="body">
                Keep listing files in a store folder at the panel root.
                Paths must point inside store/. The packer never includes that folder in the install archive, so screenshots cost your users no disk space.
                At publish, the registry validates the block, hosts the images, and inlines the about text.
                A listing that names a missing file, or breaks a limit below, refuses the whole publish.
            </PaperText>
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
                        <td><PaperCode>about</PaperCode></td>
                        <td>string</td>
                        <td>Path to a .md file, rendered with PaperMarkdown. Images in it are not rendered. At most 32 KB.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>screenshots</PaperCode></td>
                        <td>array</td>
                        <td>Up to 8 entries of light (required), dark and alt. The alt text describes the image for screen readers and is not shown on the page. Each image is a .png, .webp or .jpg of at most 2 MB. The page shows the image matching its theme. Use 4:3 frames.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>services</PaperCode></td>
                        <td>array</td>
                        <td>Websites and services the panel talks to, as name and detail rows. This card is for people reading the page.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>credits</PaperCode></td>
                        <td>array</td>
                        <td>Special thanks: libraries and people, as name and detail rows.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>requirements</PaperCode></td>
                        <td>array</td>
                        <td>Recommended system, as name and detail rows (Storage, RAM, CPU, GPU).</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body">
                Each table holds at most 12 rows. A name is at most 48 characters and a detail at most 160.
            </PaperText>

            <PaperText preset="subheader" id="local-development-and-symlinking">Local development and symlinking</PaperText>
            <PaperText preset="body">
                Paperboard scans ~/.paperboard/panels for installed applications.
                During development, symlink your repository directly into that folder rather than building distribution archives.
            </PaperText>
            <PaperText preset="body">
                Use the PaperAPI CLI to create a development link:
            </PaperText>
            <PaperCode block language="bash">
{`npx @paperboard-dev/paperapi link`}
            </PaperCode>
            <PaperText preset="body">
                You can also create the symbolic link manually using standard shell utilities:
            </PaperText>
            <PaperCode block language="bash">
{`ln -s "$PWD" ~/.paperboard/panels/dev.paperboard.my-panel`}
            </PaperCode>
            <PaperText preset="body">
                The Paperboard daemon observes active symlinks and marks them with dev provenance.
                The server will refuse to overwrite a symlinked panel with a registry download while the symlink remains active.
            </PaperText>
            <PaperText preset="body">
                To remove a link when development finishes, run:
            </PaperText>
            <PaperCode block language="bash">
{`npx @paperboard-dev/paperapi unlink dev.paperboard.my-panel`}
            </PaperCode>

            <PaperText preset="subheader" id="panel-review">Panel review and submission</PaperText>
            <PaperText preset="body">
                Paperboard does not offer an open self-serve upload registry.
                The platform registry remains closed to public automated publishing to maintain verification guarantees.
                Panels are reviewed, not sandboxed. A reviewed panel is trusted like first-party code.
            </PaperText>
            <PaperQuote variant="attention" icon="shield" title="Review process">
                If you develop a panel and wish to submit it for review and potential inclusion in the official registry, contact contact@paperboard.dev.
                This is a manual evaluation process conducted by the core engineering team. It is not an automated or standard self-serve workflow.
            </PaperQuote>
            <PaperText preset="body">
                Reviewers evaluate panels against strict engineering invariants before any release is accepted:
            </PaperText>
            <PaperCard padding="double" surface="front">
                <PaperFlex direction="column" gap="full">
                    <PaperText preset="body" weight={700}>Credential vault storage</PaperText>
                    <PaperText preset="body" color="text-subtle">
                        API keys, bot tokens, and user secrets must never exist in plaintext configuration files. All credentials must route through secretsApi.
                    </PaperText>
                    <PaperText preset="body" weight={700}>Bounded resources</PaperText>
                    <PaperText preset="body" color="text-subtle">
                        Workloads must clean up timers, bound memory buffers, teardown event subscriptions, and enforce download caps.
                    </PaperText>
                </PaperFlex>
            </PaperCard>
        </PaperFlex>
    );
}
