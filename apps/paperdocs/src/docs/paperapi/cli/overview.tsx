import {
    PaperCode,
    PaperQuote,
    PaperSeparator,
    PaperTable,
    PaperText,
    PaperLink,
    PaperTextList,
} from "@paperboard-dev/paperui";

export default function f() {
    return (
        <>
            <PaperText preset="header">CLI</PaperText>
            <PaperText preset="body">
                Reference for the <PaperCode>paperapi</PaperCode> command-line tool: development linking for fast iteration and release packaging for distribution.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                <strong>PaperAPI</strong> ships a CLI alongside the runtime library. It covers the two halves of the panel workflow: <PaperCode>link</PaperCode> mounts a repository directly into Paperboard so rebuilds appear immediately, and <PaperCode>pack</PaperCode> produces the release archive published to a registry.
            </PaperText>

            <PaperQuote variant="blue" icon="info" title="Invocation">
                The CLI is distributed as part of the @paperboard-dev/paperapi package. Run it through a package manager without installing globally: bunx paperapi, npx paperapi, or pnpm dlx paperapi.
            </PaperQuote>

            <PaperSeparator />

            <PaperText id="commands" preset="subheader">
                Commands
            </PaperText>

            <PaperTable>
                <thead>
                    <tr>
                        <th>Command</th>
                        <th>Description</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>paperapi link [dir]</PaperCode></td>
                        <td>Links a panel repository into Paperboard in development mode. Defaults to the current directory; accepts --force to replace an existing link.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>paperapi unlink &lt;panel-id&gt;</PaperCode></td>
                        <td>Removes a development link.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>paperapi links</PaperCode></td>
                        <td>Lists all active development links; broken links are flagged.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>paperapi pack [dir]</PaperCode></td>
                        <td>Builds (when needed) and packages a panel into out/&lt;id&gt;-&lt;version&gt;.tar.gz, printing release metadata including the sha256 checksum.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText id="link-workflow" preset="subheader">
                Link workflow
            </PaperText>
            <PaperText preset="body">
                A linked panel is mounted into Paperboard's panels directory by reference rather than by copy. The panel appears in the library immediately, and each rebuild of the project is reflected on the next reload:
            </PaperText>
            <PaperCode block language="bash">
                {`$ bunx paperapi link

[PaperAPI Link] Successfully linked My panel (dev.example.mypanel)
  Source: /home/dev/projects/my-panel
  Target: ~/.paperboard/panels/dev.example.mypanel

Panel is now active in Paperboard development mode!`}
            </PaperCode>

            <PaperText id="pack" preset="subheader">
                Packaging
            </PaperText>
            <PaperText preset="body">
                Packing requires a valid <PaperLink href="/paperapi/quick-start">manifest.json</PaperLink>. If the manifest's entry point is missing, the CLI runs the project's build script first. Archives contain the manifest plus the dist folder (or branding assets when present):
            </PaperText>
            <PaperCode block language="bash">
                {`$ bunx paperapi pack

[Packager] Building panel in /home/dev/projects/my-panel...
[Packager] Archiving into dev.example.mypanel-0.1.0.tar.gz...
[Packager] Packed dev.example.mypanel@0.1.0 (34.2 KB)

Release Metadata JSON:
{
  "id": "dev.example.mypanel",
  "name": "My panel",
  "version": "0.1.0",
  "archivePath": ".../out/dev.example.mypanel-0.1.0.tar.gz",
  "sha256": "9f2c...",
  "sizeBytes": 35020
}`}
            </PaperCode>

            <PaperText id="see-also" preset="subheader">
                See also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperapi/quick-start">Quick start</PaperLink> — Creating the project these commands operate on.
                </PaperText>
            </PaperTextList>
        </>
    );
}
