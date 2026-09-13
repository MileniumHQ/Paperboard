import {
    PaperCode,
    PaperContainer,
    PaperFlex,
    PaperLink,
    PaperSeparator,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@paperboard-dev/paperui";

export default function f() {
    const textPresets = [
        { preset: "headline", size: "12 (42px)", weight: "800", desc: "Hero headlines, major page banners, and display typography." },
        { preset: "header", size: "10 (34px)", weight: "700", desc: "Primary page titles and top-level documentation headings." },
        { preset: "subheader", size: "7 (24px)", weight: "600", desc: "Major sectional divisions within documents and views." },
        { preset: "title", size: "5 (20px)", weight: "700", desc: "Subsection titles, modal headings, and card titles." },
        { preset: "subtitle", size: "3 (16px)", weight: "500", desc: "Subordinate section headers and interface group titles." },
        { preset: "section", size: "1 (12px)", weight: "700", desc: "Uppercase grouping labels and sidebar category headers." },
        { preset: "body", size: "3 (16px)", weight: "400", desc: "Default prose paragraphs, descriptions, and list item text." },
        { preset: "caption", size: "1 (12px)", weight: "500", desc: "Muted captions, metadata footnotes, and secondary hints." },
    ];

    return (
        <>
            <PaperText preset="header">Typography and fonts</PaperText>
            <PaperText preset="body">
                The typography system of PaperUI, defining standard typefaces, numerical scale variables, preset configurations, and the PaperText primitive.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                <strong>PaperUI typography</strong> is built upon a dual-typeface strategy combining <strong>Nunito Sans</strong> for high-legibility body prose and <strong>Nunito</strong> (a rounded variant) for approachable headings, badges, and brand elements. Code listings utilize <strong>SUSE Mono</strong>, and iconography is rendered via Google's <strong>Material Symbols Rounded</strong> font family.
            </PaperText>

            <PaperSeparator />

            <PaperText id="font-families" preset="subheader">
                Font family tokens
            </PaperText>
            <PaperText preset="body">
                PaperUI exposes three primary font family variables on the root stylesheet:
            </PaperText>

            <PaperTable>
                <thead>
                    <tr>
                        <th>CSS Variable</th>
                        <th>Primary Family</th>
                        <th>Fallback Stack</th>
                        <th>Usage</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>--paper-font-family</PaperCode></td>
                        <td>Nunito Sans</td>
                        <td>"Nunito Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif</td>
                        <td>Standard interface copy, input elements, buttons, and tables.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-font-family-rounded</PaperCode></td>
                        <td>Nunito</td>
                        <td>"Nunito", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif</td>
                        <td>Headers, brand marks, and rounded text components.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-font-family-code</PaperCode></td>
                        <td>SUSE Mono</td>
                        <td>"SUSE Mono", monospace</td>
                        <td>Code blocks, inline tokens, keyboard accelerators, and technical data.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="typographic-scale" preset="subheader">
                Typographic scale
            </PaperText>
            <PaperText preset="body">
                Font sizes in PaperUI are structured into an 18-token numerical scale (<PaperCode>--paper-text-size-0</PaperCode> through <PaperCode>--paper-text-size-17</PaperCode>) accessible through CSS Custom Properties. The demo below renders steps 1 through 12; steps 13 through 17 are display sizes reserved for large-scale hero typography:
            </PaperText>

            <PaperContainer>
                <PaperFlex padding="full" gap="full">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((step) => (
                        <PaperFlex
                            padding="half"
                            gap="onefourth"
                            style={{
                                width: "100%",
                                background: "var(--paper-background-frontest)",
                                "border-radius": "var(--paper-border-radius)",
                                border: "1px solid var(--paper-medium-border)",
                            }}
                        >
                            <PaperFlex direction="row" align="center" justify="space-between">
                                <PaperCode>--paper-text-size-{step}</PaperCode>
                                <PaperText size={1} color="var(--paper-light-text)">Step {step}</PaperText>
                            </PaperFlex>
                            <PaperText size={step} style={{ "word-break": "break-word" }}>
                                The quick brown fox jumps over the lazy dog
                            </PaperText>
                        </PaperFlex>
                    ))}
                </PaperFlex>
            </PaperContainer>

            <PaperSeparator />

            <PaperText id="presets" preset="subheader">
                PaperText presets
            </PaperText>
            <PaperText preset="body">
                The <PaperLink href="/paperui/papertext"><PaperCode>PaperText</PaperCode></PaperLink> component simplifies typography by bundling standardized size and weight pairings into convenient presets:
            </PaperText>

            <PaperTable>
                <thead>
                    <tr>
                        <th>Preset</th>
                        <th>Scale Step</th>
                        <th>Font Weight</th>
                        <th>Application</th>
                    </tr>
                </thead>
                <tbody>
                    {textPresets.map((p) => (
                        <tr>
                            <td><PaperCode>{p.preset}</PaperCode></td>
                            <td>{p.size}</td>
                            <td>{p.weight}</td>
                            <td>{p.desc}</td>
                        </tr>
                    ))}
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperui/papertext">PaperText</PaperLink> — The polymorphic text primitive supporting presets, sizes, and weights.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/papertextlist">PaperTextList</PaperLink> — List container for ordered and unordered typography blocks.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/papercode">PaperCode</PaperLink> — Monospaced syntax-highlighted code rendering.
                </PaperText>
            </PaperTextList>
        </>
    );
}
