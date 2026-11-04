import {
    PaperButton,
    PaperCard,
    PaperCenteredInterface,
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PaperCenteredInterfaceDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperCenteredInterface</PaperText>
            <PaperText preset="body" as="p">
                PaperCenteredInterface centers a fixed-size content box in the middle of its parent, sized by a preset.
                Use it for a screen that should not stretch to the window: a sign-in form, a setup prompt, a single-purpose tool.
                The box scrolls its own content when it overflows.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                The component fills its parent, so give it a parent with a height.
                Choose a size with <PaperCode>preset</PaperCode>.
            </PaperText>
            <PaperCard data-docs-demo surface="back" height="panel-height">
                <PaperCenteredInterface preset="small">
                    <PaperCard padding="double" surface="frontest" fullHeight>
                        <PaperFlex direction="column" gap="full" center fullHeight>
                            <PaperText preset="title" as="h3">Centered</PaperText>
                            <PaperButton variant="primary">Continue</PaperButton>
                        </PaperFlex>
                    </PaperCard>
                </PaperCenteredInterface>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperButton, PaperCard, PaperCenteredInterface, PaperFlex, PaperText } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperCenteredInterface preset="small">
            <PaperCard padding="double" surface="frontest" fullHeight>
                <PaperFlex direction="column" gap="full" center fullHeight>
                    <PaperText preset="title" as="h3">Centered</PaperText>
                    <PaperButton variant="primary">Continue</PaperButton>
                </PaperFlex>
            </PaperCard>
        </PaperCenteredInterface>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="body" as="p">
                PaperCenteredInterfaceProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode>.
                Extra props, <PaperCode>class</PaperCode> and <PaperCode>style</PaperCode> land on the outer element that fills the parent.
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
                        <td><PaperCode>preset</PaperCode></td>
                        <td><PaperCode>PaperCenteredInterfacePreset</PaperCode></td>
                        <td>No default (600 by 400)</td>
                        <td>The box size. See Presets.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>size</PaperCode></td>
                        <td><PaperCode>PaperCenteredInterfacePreset</PaperCode></td>
                        <td>No default</td>
                        <td>An alias of <PaperCode>preset</PaperCode>. When both are set, <PaperCode>preset</PaperCode> wins.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>width</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>A CSS width for the box, over the preset's. Pass a token with <PaperCode>getVarCss("size-field-wide")</PaperCode>, not a pixel value.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>height</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>A CSS height for the box, over the preset's.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="presets">Presets</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>PaperCenteredInterfacePreset</PaperCode> is <PaperCode>"small" | "compact" | "medium" | "large" | "wide" | "full" | "fullscreen" | "auto" | "fit"</PaperCode>.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Preset</th>
                        <th>Box</th>
                        <th>Tokens</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>None</td>
                        <td>600 by 400 pixels</td>
                        <td><PaperCode>panel</PaperCode>, <PaperCode>panel-height</PaperCode></td>
                    </tr>
                    <tr>
                        <td><PaperCode>small</PaperCode>, <PaperCode>compact</PaperCode></td>
                        <td>420 by 300 pixels</td>
                        <td><PaperCode>panel-small</PaperCode>, <PaperCode>panel-height-small</PaperCode></td>
                    </tr>
                    <tr>
                        <td><PaperCode>medium</PaperCode></td>
                        <td>600 by 400 pixels</td>
                        <td><PaperCode>panel-medium</PaperCode>, <PaperCode>panel-height-medium</PaperCode></td>
                    </tr>
                    <tr>
                        <td><PaperCode>large</PaperCode></td>
                        <td>760 by 520 pixels</td>
                        <td><PaperCode>panel-large</PaperCode>, <PaperCode>panel-height-large</PaperCode></td>
                    </tr>
                    <tr>
                        <td><PaperCode>wide</PaperCode></td>
                        <td>920 by 580 pixels</td>
                        <td><PaperCode>panel-wide</PaperCode>, <PaperCode>panel-height-wide</PaperCode></td>
                    </tr>
                    <tr>
                        <td><PaperCode>full</PaperCode>, <PaperCode>fullscreen</PaperCode></td>
                        <td>100% by 100% of the parent</td>
                        <td>None</td>
                    </tr>
                    <tr>
                        <td><PaperCode>auto</PaperCode>, <PaperCode>fit</PaperCode></td>
                        <td>The size of the content, at most 100% by 100%</td>
                        <td>None</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperTextList>
                <li>The outer element is 100% wide and tall and centers the box on both axes. In a parent with no height it collapses to its content.</li>
                <li>The box has <PaperCode>12px</PaperCode> padding (<PaperCode>--paper-uigap</PaperCode>), no surface and no border. Draw the surface yourself, such as a <PaperLink href="/docs/paperui/papercard/">PaperCard</PaperLink> with <PaperCode>fullHeight</PaperCode>.</li>
                <li>The box content scrolls (<PaperCode>overflow: auto</PaperCode>) when it is taller or wider than the box.</li>
                <li>Fixed presets do not shrink below their size. In a window narrower than the box, the box overflows the parent. Use <PaperCode>full</PaperCode> or <PaperCode>auto</PaperCode> where the window can be narrow.</li>
                <li>The chosen preset is written to <PaperCode>data-preset</PaperCode> on the outer element.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="fit">Sized by its content</PaperText>
            <PaperCode block language="tsx">
{`<PaperCenteredInterface preset="fit">
    <PaperCard padding="double" surface="frontest">
        <PaperText>Only as big as this text.</PaperText>
    </PaperCard>
</PaperCenteredInterface>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="token-width">A token width</PaperText>
            <PaperCode block language="tsx">
{`import { PaperCenteredInterface, PaperText, getVarCss } from "@mileniumhq/paperui";

<PaperCenteredInterface preset="auto" width={getVarCss("size-panel-small")}>
    <PaperText>Content</PaperText>
</PaperCenteredInterface>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="neighbors">Choosing a neighbor</PaperText>
            <PaperTextList>
                <li>A dialog over the page is <PaperLink href="/docs/paperui/papermodal/">PaperModal</PaperLink>.</li>
                <li>A readable column that fills the window is <PaperLink href="/docs/paperui/paperpage/">PaperPage</PaperLink>.</li>
                <li>A multi-step flow inside the box is <PaperLink href="/docs/paperui/paperwizard/">PaperWizard</PaperLink>.</li>
            </PaperTextList>
        </PaperFlex>
    );
}
