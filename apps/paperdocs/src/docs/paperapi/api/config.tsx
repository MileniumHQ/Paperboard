import {
    PaperCode,
    PaperLink,
    PaperQuote,
    PaperSeparator,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@paperboard-dev/paperui";

export default function f() {
    return (
        <>
            <PaperText preset="header">Config API</PaperText>
            <PaperText preset="body">
                Reference for the <PaperCode>config</PaperCode> namespace: persisting small JSON configuration documents that survive restarts.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                <strong>Config API</strong> stores a single JSON document per panel — or per named key within a panel — as a file in the host's configuration directory. It is intended for settings and small state: server properties, user preferences, wizard answers. Use Files API instead when data is large or not JSON-shaped.
            </PaperText>
            <PaperText preset="body">
                Calls without an explicit id default to the calling panel's identifier, so the common case needs no arguments at all.
            </PaperText>

            <PaperQuote variant="blue" icon="info" title="Writes are atomic">
                Configuration files are written through a temporary file and renamed into place, so an interrupted write cannot corrupt existing settings.
            </PaperQuote>

            <PaperText id="usage" preset="subheader">
                Usage
            </PaperText>
            <PaperCode block language="tsx">
                {`import { config } from "@paperboard-dev/paperapi";

// Store any JSON-serializable value
await config.set({
    theme: "dark",
    autosave: true,
    lastWorld: "overworld",
});

// Read it back (typed by the caller)
const settings = await config.get<{ theme: string }>();

// Named sub-documents, useful for multi-document panels
await config.set({ rows: 25 }, "server-eu");
const eu = await config.get("server-eu");`}
            </PaperCode>

            <PaperSeparator />

            <PaperText id="reference" preset="subheader">
                Reference
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
                        <td><PaperCode>get</PaperCode></td>
                        <td><PaperCode>(id?) =&gt; Promise&lt;T&gt;</PaperCode></td>
                        <td>Reads the document stored under id; defaults to the panel's own id. Returns null when nothing was stored.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>set</PaperCode></td>
                        <td><PaperCode>(data, id?) =&gt; Promise&lt;void&gt;</PaperCode></td>
                        <td>Replaces the document stored under id with the given JSON value.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperapi/files">Files API</PaperLink> — General-purpose storage for non-JSON or bulky data.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperwizard">PaperWizard</PaperLink> — PaperUI template suited to collecting settings before config.set.
                </PaperText>
            </PaperTextList>
        </>
    );
}
