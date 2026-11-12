import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function StoreListingDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">Store listing</PaperText>
            <PaperText preset="body" as="p">
                The manifest's store block fills the panel's page in the Panel Library: screenshots, a long description, and up to three information sections.
                Paperboard reads it only when the panel is published, and the files it names stay out of the install archive.
                Every field is optional, and a panel without the block gets a page with its name, description, publisher and install button.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                Keep the listing's files in a <PaperCode>store/</PaperCode> folder at the panel root and name them in <PaperCode>manifest.json</PaperCode>.
            </PaperText>
            <PaperCode block language="json">
{`{
    "id": "dev.example.weather",
    "name": "Weather",
    "version": "1.0.0",
    "store": {
        "about": "./store/about.md",
        "screenshots": [
            { "light": "./store/1-light.png", "dark": "./store/1-dark.png", "alt": "Forecast for three cities" }
        ],
        "services": [{ "name": "Open-Meteo", "detail": "Fetching forecasts" }],
        "credits": [{ "name": "Material Symbols", "detail": "Weather icons" }],
        "requirements": [{ "name": "Network", "detail": "Internet access" }]
    }
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="fields">Fields</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Field</th>
                        <th>Type</th>
                        <th>Default</th>
                        <th>What it shows</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>about</PaperCode></td>
                        <td><PaperCode>string</PaperCode>: a path to a <PaperCode>.md</PaperCode> file</td>
                        <td>No default (no long description)</td>
                        <td>The long description, rendered with <PaperLink href="/docs/paperui/papermarkdown/">PaperMarkdown</PaperLink> under the screenshots. At most 32 KB.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>screenshots</PaperCode></td>
                        <td><PaperCode>StoreScreenshot[]</PaperCode></td>
                        <td><PaperCode>[]</PaperCode></td>
                        <td>Up to 8 images in a gallery at the top of the page.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>services</PaperCode></td>
                        <td><PaperCode>StoreRow[]</PaperCode></td>
                        <td><PaperCode>[]</PaperCode></td>
                        <td>The "Services used" section: websites and services the panel contacts, each with what the panel uses it for.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>credits</PaperCode></td>
                        <td><PaperCode>StoreRow[]</PaperCode></td>
                        <td><PaperCode>[]</PaperCode></td>
                        <td>The "Special thanks" section: projects and people the panel builds on.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>requirements</PaperCode></td>
                        <td><PaperCode>StoreRow[]</PaperCode></td>
                        <td><PaperCode>[]</PaperCode></td>
                        <td>The "Recommended system" section: storage, memory, processor, graphics.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperCode block language="tsx">
{`interface StoreScreenshot {
    /** shown in light mode, and in dark mode when there is no dark */
    light: string;
    dark?: string;
    /** 1 to 120 characters; without it, "<panel name> screenshot <n>" */
    alt?: string;
}

interface StoreRow {
    /** 1 to 48 characters */
    name: string;
    /** 1 to 160 characters */
    detail: string;
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperTextList>
                <li>Every path is relative to the panel root and inside <PaperCode>store/</PaperCode>: <PaperCode>./store/1-light.png</PaperCode> or <PaperCode>store/shots/1.png</PaperCode>. Path parts use letters, digits, <PaperCode>.</PaperCode>, <PaperCode>_</PaperCode> and <PaperCode>-</PaperCode>, and <PaperCode>..</PaperCode> is refused.</li>
                <li>Screenshots are <PaperCode>.png</PaperCode>, <PaperCode>.webp</PaperCode>, <PaperCode>.jpg</PaperCode> or <PaperCode>.jpeg</PaperCode> files of at most 2 MB each. The gallery crops each one to 4:3 from the top, so make them 4:3.</li>
                <li>The sections run in the order Recommended system, Services used, Special thanks, each a full-width list with the name on the left and the detail on the right. Each holds at most 12 rows. A section with no rows is not shown.</li>
                <li>Names and details are trimmed. An empty one after trimming is an error.</li>
                <li>The publish step validates the block, uploads the images to the registry and inlines the about text. A listing that names a missing file or breaks a limit refuses the whole publish, with the reason, such as <PaperCode>store.screenshots has more than 8 entries</PaperCode> or <PaperCode>store.services[0] needs a name (max 48) and a detail (max 160)</PaperCode>.</li>
                <li><PaperCode>paperapi pack</PaperCode> never puts <PaperCode>store/</PaperCode> in the install archive, so screenshots take no space on the computers that install the panel.</li>
                <li>The Paperboard server daemon ignores the block. A listing grants the panel nothing.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="errors">Errors</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Error</th>
                        <th>Cause</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>store must be an object</PaperCode></td><td>The block is an array or a value.</td></tr>
                    <tr><td><PaperCode>store.&lt;field&gt; must be a relative path inside store/</PaperCode></td><td>A path is absolute, outside <PaperCode>store/</PaperCode>, or contains <PaperCode>..</PaperCode>.</td></tr>
                    <tr><td><PaperCode>store.&lt;field&gt; must be a .png, .webp or .jpg image</PaperCode></td><td>A screenshot has another extension.</td></tr>
                    <tr><td><PaperCode>store.about must be a .md file</PaperCode></td><td><PaperCode>about</PaperCode> names another kind of file.</td></tr>
                    <tr><td><PaperCode>store.screenshots[&lt;n&gt;].alt must be 1-120 characters</PaperCode></td><td>An empty or long <PaperCode>alt</PaperCode>.</td></tr>
                    <tr><td><PaperCode>store.&lt;table&gt; has more than 12 rows</PaperCode></td><td>Too many rows in a section.</td></tr>
                    <tr><td><PaperCode>about exceeds the 32768-byte cap</PaperCode></td><td>The about file is over 32 KB.</td></tr>
                </tbody>
            </PaperTable>

            <PaperText preset="body" as="p">
                The listing's types and limits are exported for tools that build listings: <PaperCode>parseStoreManifest</PaperCode>, <PaperCode>STORE_MAX_SCREENSHOTS</PaperCode>, <PaperCode>STORE_MAX_ROWS</PaperCode>, <PaperCode>STORE_MAX_ABOUT_BYTES</PaperCode> and <PaperCode>STORE_MAX_SCREENSHOT_BYTES</PaperCode>.
                Next: <PaperLink href="/docs/paperapi/widgets/">Home widgets</PaperLink>.
            </PaperText>
        </PaperFlex>
    );
}
