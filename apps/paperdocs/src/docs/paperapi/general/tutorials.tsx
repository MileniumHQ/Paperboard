import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function TutorialsDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">Tutorials</PaperText>
            <PaperText preset="body" as="p">
                The manifest's tutorial array is a few short pages Paperboard shows the first time someone opens the panel.
                Each page has a title, a line or two of text, and a picture of the panel or an icon.
                Use it to point out what the panel does that a person would not find alone.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperCode block language="json">
{`{
    "id": "dev.example.weather",
    "name": "Weather",
    "version": "1.0.0",
    "tutorial": [
        {
            "image": { "light": "./tutorial/1-light.webp", "dark": "./tutorial/1-dark.webp", "alt": "Forecasts for three cities side by side" },
            "title": "Every city at once",
            "body": "Add the cities you care about and their forecasts sit side by side."
        },
        {
            "icon": "notifications",
            "title": "Warnings come to you",
            "body": "A storm warning for one of your cities shows on Home."
        }
    ]
}`}
            </PaperCode>
            <PaperText preset="body" as="p">
                Image paths are relative to the panel's build. Put the files in <PaperCode>dist/</PaperCode>: in a Vite panel, put them in <PaperCode>public/tutorial/</PaperCode> and the build copies them.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="fields">Fields</PaperText>
            <PaperCode block language="tsx">
{`interface TutorialStep {
    title: string;
    body: string;
    /** a picture of the panel shown beside the text */
    image?: TutorialImage;
    /** a Material Symbols name shown above the title, for a step without an image */
    icon?: string;
}

interface TutorialImage {
    /** shown in light mode, and in dark mode when there is no dark */
    light: string;
    dark?: string;
    /** what the picture shows, for anyone who can't see it */
    alt: string;
}`}
            </PaperCode>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Field</th>
                        <th>Type</th>
                        <th>Default</th>
                        <th>Rule</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>tutorial</PaperCode></td>
                        <td><PaperCode>TutorialStep[]</PaperCode></td>
                        <td>No default (no tutorial)</td>
                        <td>1 to 6 steps. An empty array is an error.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>title</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>Required</td>
                        <td>At most 80 characters, and not blank.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>body</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>Required</td>
                        <td>At most 400 characters, and not blank. Plain text.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>image.light</PaperCode>, <PaperCode>image.dark</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td><PaperCode>light</PaperCode> required in an image, <PaperCode>dark</PaperCode> optional</td>
                        <td>A relative path to a <PaperCode>.png</PaperCode>, <PaperCode>.webp</PaperCode>, <PaperCode>.jpg</PaperCode> or <PaperCode>.jpeg</PaperCode> file, with no <PaperCode>..</PaperCode>, starting with a letter, digit, <PaperCode>_</PaperCode>, <PaperCode>-</PaperCode> or <PaperCode>./</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>image.alt</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>Required in an image</td>
                        <td>At most 120 characters, and not blank.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>icon</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>A Material Symbols name: lowercase letters, digits and <PaperCode>_</PaperCode>, up to 48 characters, such as <PaperCode>notifications</PaperCode>.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperTextList>
                <li>The shell opens the tutorial the first time the panel is the open tab, after Paperboard's own first-run tutorial.</li>
                <li>Finishing it is remembered for the panel id on this Paperboard, for every computer the panel runs on. A new version of the panel does not show it again.</li>
                <li>The panel's context menu in the sidebar offers <PaperCode>Show Tutorial</PaperCode> whenever the manifest declares one.</li>
                <li>Images load from the panel's origin, the same way its pages do.</li>
                <li>The daemon and <PaperCode>paperapi pack</PaperCode> check the same rules. A broken step makes the daemon refuse the whole manifest (<PaperCode>Invalid tutorial in manifest for &lt;id&gt;: &lt;reason&gt;</PaperCode>), and the packer also refuses an image missing from <PaperCode>dist/</PaperCode>.</li>
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
                    <tr><td><PaperCode>manifest tutorial must be an array</PaperCode></td><td><PaperCode>tutorial</PaperCode> is an object or a value.</td></tr>
                    <tr><td><PaperCode>a tutorial has 1 to 6 steps</PaperCode></td><td>Zero steps, or more than six.</td></tr>
                    <tr><td><PaperCode>tutorial step &lt;n&gt; needs a title of at most 80 characters</PaperCode></td><td>A missing, empty or long title.</td></tr>
                    <tr><td><PaperCode>tutorial step &lt;n&gt; needs a body of at most 400 characters</PaperCode></td><td>A missing, empty or long body.</td></tr>
                    <tr><td><PaperCode>tutorial step &lt;n&gt; image paths must be relative png/webp/jpg/jpeg files inside the build</PaperCode></td><td>A bad image path.</td></tr>
                    <tr><td><PaperCode>tutorial step &lt;n&gt; image needs alt text of at most 120 characters</PaperCode></td><td>A missing, empty or long <PaperCode>alt</PaperCode>.</td></tr>
                    <tr><td><PaperCode>tutorial step &lt;n&gt; icon must be a Material Symbols name</PaperCode></td><td>An icon outside the name rule.</td></tr>
                    <tr><td><PaperCode>manifest tutorial shows &lt;path&gt; but dist/&lt;path&gt; does not exist; build it before packing</PaperCode></td><td>The packer found no file for an image.</td></tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                Step numbers in errors count from 0. The rule is exported as <PaperCode>validateTutorialDeclaration</PaperCode>, with the limits <PaperCode>MAX_TUTORIAL_STEPS</PaperCode>, <PaperCode>MAX_TUTORIAL_TITLE_LENGTH</PaperCode>, <PaperCode>MAX_TUTORIAL_BODY_LENGTH</PaperCode> and <PaperCode>MAX_TUTORIAL_ALT_LENGTH</PaperCode>.
                Next: <PaperLink href="/docs/paperapi/widgets/">Home widgets</PaperLink>.
            </PaperText>
        </PaperFlex>
    );
}
