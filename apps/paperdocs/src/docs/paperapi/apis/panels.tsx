import {
    PaperCode,
    PaperFlex,
    PaperTable,
    PaperText,
} from "@paperboard-dev/paperui";

export default function PanelsApiDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">Panels API</PaperText>
            <PaperText preset="body">
                panelsApi queries installed panel records, retrieves registry indexes, and triggers panel installations.
                Reach for panelsApi when building store catalogs, package managers, or panel launcher switchers.
                The API tracks installation provenance and registry publication metadata.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Import panelsApi or panels from @paperboard-dev/paperapi.
                Query local panels or merge installed state with the online catalog.
            </PaperText>
            <PaperCode block language="tsx">
{`import { panelsApi } from "@paperboard-dev/paperapi";

// List all installed panels
const installedPanels = await panelsApi.list();

// Retrieve combined registry catalog
const registryPanels = await panelsApi.registry();`}
            </PaperCode>

            <PaperText preset="subheader" id="methods-and-signatures">Methods and signatures</PaperText>
            <PaperText preset="body">
                The module exposes the following lifecycle methods:
            </PaperText>

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
                        <td><PaperCode>list</PaperCode></td>
                        <td><PaperCode>list(scope?): Promise&lt;PanelItem[]&gt;</PaperCode></td>
                        <td>Returns an array of all panels currently installed on the host daemon.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>registry</PaperCode></td>
                        <td><PaperCode>registry(scope?): Promise&lt;PanelItem[]&gt;</PaperCode></td>
                        <td>Fetches the public registry index and annotates items with local installation status.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>install</PaperCode></td>
                        <td><PaperCode>install(panelId, scope?): Promise&lt;boolean&gt;</PaperCode></td>
                        <td>Requests the host daemon to download and activate the specified panel.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>uninstall</PaperCode></td>
                        <td><PaperCode>uninstall(panelId, scope?): Promise&lt;boolean&gt;</PaperCode></td>
                        <td>Deactivates and removes an installed panel package. User data is preserved.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                Each returned PanelItem includes installSource provenance: "registry" for reviewed releases, "direct" for checksummed URLs, or "dev" for symlinks. For an installed panel, registry() reports the installed manifest's name, description, publisher and version; latestVersion carries the newest release the registry offers.
                Installing from the registry will refuse to overwrite panels marked with dev provenance.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Filter installed panels to locate developer links during testing.
            </PaperText>
            <PaperCode block language="tsx">
{`const panels = await panelsApi.list();
const devPanels = panels.filter((p) => p.isLinked);`}
            </PaperCode>
        </PaperFlex>
    );
}
