import {
    PaperCode,
    PaperFlex,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";

export default function TypographyDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">Typography</PaperText>
            <PaperText preset="body">
                PaperUI typography establishes consistent font families, numerical size steps, and text contrast tiers.
                Reach for these variables when configuring text blocks, custom SVG labels, or monospace readouts.
                The typography system bundles local variable fonts for Nunito Sans, Nunito, and SUSE Mono.
            </PaperText>

            <PaperText preset="subheader" id="font-families">Font families</PaperText>
            <PaperText preset="body">
                Three font families serve distinct roles:
            </PaperText>

            <PaperTable>
                <thead>
                    <tr>
                        <th>Variable</th>
                        <th>Target font</th>
                        <th>Role</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>--paper-font-family</PaperCode></td>
                        <td>"Nunito Sans", -apple-system, sans-serif</td>
                        <td>Primary interface body copy, buttons, and form inputs</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-font-family-rounded</PaperCode></td>
                        <td>"Nunito", -apple-system, sans-serif</td>
                        <td>Rounded variant used for friendly titles and monograms</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-font-family-code</PaperCode></td>
                        <td>"SUSE Mono", monospace</td>
                        <td>Code blocks, terminal logs, and keycaps</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" id="text-colors">Text colors</PaperText>
            <PaperText preset="body">
                Text color tokens define four contrast tiers:
            </PaperText>

            <PaperTable>
                <thead>
                    <tr>
                        <th>Variable</th>
                        <th>Contrast tier</th>
                        <th>Light value</th>
                        <th>Dark value</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>--paper-text</PaperCode></td>
                        <td>High contrast primary headings and body copy</td>
                        <td>#0f1319</td>
                        <td>#f5f5f5</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-text-muted</PaperCode></td>
                        <td>Medium contrast secondary labels and descriptions</td>
                        <td>#2e3440</td>
                        <td>#d4d4d4</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-text-subtle</PaperCode></td>
                        <td>Lower contrast captions and metadata tags</td>
                        <td>#5b6371</td>
                        <td>#a1a1a1</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-text-faint</PaperCode></td>
                        <td>Lowest contrast placeholder and inactive hints</td>
                        <td>#8b93a2</td>
                        <td>#737373</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" id="size-scale">Size scale</PaperText>
            <PaperText preset="body">
                Font sizes follow numerical indices from index 0 through index 17:
            </PaperText>

            <PaperTable>
                <thead>
                    <tr>
                        <th>Index</th>
                        <th>Variable</th>
                        <th>Pixel size</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>1</td>
                        <td><PaperCode>--paper-text-size-1</PaperCode></td>
                        <td>12px</td>
                    </tr>
                    <tr>
                        <td>2</td>
                        <td><PaperCode>--paper-text-size-2</PaperCode></td>
                        <td>14px</td>
                    </tr>
                    <tr>
                        <td>3</td>
                        <td><PaperCode>--paper-text-size-3</PaperCode></td>
                        <td>16px</td>
                    </tr>
                    <tr>
                        <td>4</td>
                        <td><PaperCode>--paper-text-size-4</PaperCode></td>
                        <td>18px</td>
                    </tr>
                    <tr>
                        <td>6</td>
                        <td><PaperCode>--paper-text-size-6</PaperCode></td>
                        <td>22px</td>
                    </tr>
                    <tr>
                        <td>8</td>
                        <td><PaperCode>--paper-text-size-8</PaperCode></td>
                        <td>26px</td>
                    </tr>
                    <tr>
                        <td>10</td>
                        <td><PaperCode>--paper-text-size-10</PaperCode></td>
                        <td>34px</td>
                    </tr>
                    <tr>
                        <td>12</td>
                        <td><PaperCode>--paper-text-size-12</PaperCode></td>
                        <td>42px</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" id="weights-and-leading">Weights and line heights</PaperText>
            <PaperText preset="body">
                Components name a step rather than a number, so a weight or line height changes everywhere at once.
            </PaperText>

            <PaperTable>
                <thead>
                    <tr>
                        <th>Variable</th>
                        <th>Value</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>--paper-weight-regular</PaperCode></td>
                        <td>400</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-weight-medium</PaperCode></td>
                        <td>500</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-weight-semibold</PaperCode></td>
                        <td>600</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-weight-bold</PaperCode></td>
                        <td>700</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-weight-black</PaperCode></td>
                        <td>900, display type only, such as a wordmark</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-leading-none</PaperCode></td>
                        <td>1</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-leading-tight</PaperCode></td>
                        <td>1.1</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-leading-snug</PaperCode></td>
                        <td>1.25</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-leading-normal</PaperCode></td>
                        <td>1.45</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-leading-relaxed</PaperCode></td>
                        <td>1.6</td>
                    </tr>
                </tbody>
            </PaperTable>
        </PaperFlex>
    );
}
