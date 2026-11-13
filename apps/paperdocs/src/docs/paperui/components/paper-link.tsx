import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PaperLinkDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperLink</PaperText>
            <PaperText preset="body" as="p">
                PaperLink is a styled anchor that goes to a URL, with a marker on external links.
                Use it for links inside sentences and for pointers to documentation or a website.
                Use <PaperLink href="/docs/paperui/paperbutton/">PaperButton</PaperLink> with <PaperCode>href</PaperCode> when the link is a call to action.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                Pass <PaperCode>href</PaperCode>.
                An address that starts with <PaperCode>http</PaperCode> is external: it opens in a new tab and shows an arrow icon.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperText preset="body" as="p">
                    Read the <PaperLink href="/docs/paperui/paperbutton/">PaperButton page</PaperLink> or visit <PaperLink href="https://paperboard.dev">paperboard.dev</PaperLink>.
                </PaperText>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperCard, PaperLink, PaperText } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="front">
            <PaperText preset="body" as="p">
                Read the <PaperLink href="/docs/paperui/paperbutton/">PaperButton page</PaperLink> or visit <PaperLink href="https://paperboard.dev">paperboard.dev</PaperLink>.
            </PaperText>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="body" as="p">
                PaperLinkProps extends <PaperCode>JSX.AnchorHTMLAttributes&lt;HTMLAnchorElement&gt;</PaperCode>.
                Other props, such as <PaperCode>href</PaperCode>, <PaperCode>onClick</PaperCode>, <PaperCode>download</PaperCode>, and <PaperCode>aria-label</PaperCode>, land on the <PaperCode>a</PaperCode>.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Prop</th>
                        <th>Type</th>
                        <th>Default</th>
                        <th>Effect</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>href</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>The destination.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>external</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>Guessed from <PaperCode>href</PaperCode></td>
                        <td>Defaults to <PaperCode>true</PaperCode> when <PaperCode>href</PaperCode> starts with <PaperCode>http</PaperCode>, else <PaperCode>false</PaperCode>. An external link gets <PaperCode>target="_blank"</PaperCode>, <PaperCode>rel="noopener noreferrer"</PaperCode>, and a trailing open-in-new icon. Set it to override the guess either way.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>target</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>An external link gets <PaperCode>"_blank"</PaperCode> unless you pass a value. An internal link gets none.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>rel</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>An external link gets <PaperCode>"noopener noreferrer"</PaperCode> unless you pass a value, which replaces it whole. An internal link gets none.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>children</PaperCode></td>
                        <td><PaperCode>JSX.Element</PaperCode></td>
                        <td>No default</td>
                        <td>The link text.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the anchor.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperTextList>
                <li>The link is a plain anchor. A path such as <PaperCode>/docs/paperui/</PaperCode> makes the browser load that URL: PaperLink has no router and does no client-side navigation.</li>
                <li>Only addresses starting with <PaperCode>http</PaperCode> count as external on their own. A <PaperCode>mailto:</PaperCode> or other scheme needs <PaperCode>external</PaperCode> if you want the new tab and marker.</li>
                <li>The link is inline, so it wraps with the text around it. The marker follows its last word, on the same line.</li>
                <li>The marker is an icon after the text and is hidden from assistive technology. Say in the link text where it leads, because the marker has no name.</li>
                <li>The link is bold, in the primary color, and underlines on hover (and on press on touch devices).</li>
                <li>Do not use <PaperCode>href="#"</PaperCode> with a click handler for an action. An action is a PaperButton.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="same-tab">An external link in the same tab</PaperText>
            <PaperCode block language="tsx">
{`<PaperLink href="https://paperboard.dev" external={false}>paperboard.dev</PaperLink>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="mailto">A mailto link marked as external</PaperText>
            <PaperCode block language="tsx">
{`<PaperLink href="mailto:support@example.com" external>support@example.com</PaperLink>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="in-panels">Links in a panel</PaperText>
            <PaperText preset="body" as="p">
                The gameserver panel links to the Minecraft EULA, the Minecraft Wiki, and the page of an add-on with PaperLink, so each opens in a new tab with the marker.
                Put the destination's name in the link text, not "click here".
            </PaperText>
        </PaperFlex>
    );
}
