import {
    PaperCode,
    PaperContainer,
    PaperFlex,
    PaperLink,
    PaperQuote,
    PaperSeparator,
    PaperText,
    PaperTextList,
} from "@paperboard-dev/paperui";

export default function f() {
    return (
        <>
            <PaperText preset="header">Introduction</PaperText>
            <PaperText preset="body">
                An encyclopedic overview of PaperUI, its architecture, design philosophy, and integration within the Paperboard application framework.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                <strong>PaperUI</strong> is a component library and design system engineered for the <PaperLink href="https://docs.solidjs.com/" external>SolidJS</PaperLink> declarative reactive framework. Originally developed as the primary graphical user interface foundation for Paperboard and its extensible panel ecosystem, PaperUI provides a curated collection of pre-styled, accessible, and theme-adaptive user interface primitives and structural templates.
            </PaperText>
            <PaperText preset="body">
                The library prioritizes tactile visual feedback, systematic tokenization through CSS Custom Properties, and zero-runtime overhead via SolidJS fine-grained reactivity.
            </PaperText>

            <PaperQuote variant="blue" icon="info" title="Design system scope">
                PaperUI is primarily tailored for Paperboard extension development and desktop-class web applications requiring cohesive visual hierarchy, elevation dynamics, and consistent typography.
            </PaperQuote>

            <PaperSeparator />

            <PaperText id="design-principles" preset="subheader">
                Design principles
            </PaperText>
            <PaperText preset="body">
                The architecture of PaperUI adheres to four primary engineering and design principles:
            </PaperText>

            <PaperText id="fine-grained-reactivity" preset="title">
                1. Fine-grained reactivity
            </PaperText>
            <PaperText preset="body">
                PaperUI components leverage SolidJS reactive primitives—such as signals, memos, and effects—without an intermediate virtual DOM layer. Component instances execute their setup logic once, directly binding reactive expressions to DOM nodes. This approach reduces memory consumption compared to virtual DOM diffing.
            </PaperText>

            <PaperText id="systematic-tokenization" preset="title">
                2. Systematic tokenization
            </PaperText>
            <PaperText preset="body">
                Visual appearance across PaperUI is governed by standardized design tokens declared in CSS Custom Properties. Hard-coded dimension and color literals are discouraged across the ecosystem in favor of centralized variables governing:
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    Surfaces and color semantics: Adaptive palettes conforming to light and dark modes via semantic tokens such as <PaperCode>--paper-background-front</PaperCode> and <PaperCode>--paper-front-blue</PaperCode>.
                </PaperText>
                <PaperText preset="body">
                    Spacing and geometry: Proportional spacing multipliers scaled from <PaperCode>--paper-uigap</PaperCode> (12px base), alongside uniform border radii and border widths.
                </PaperText>
                <PaperText preset="body">
                    Typographic hierarchy: Discrete sizing tokens (<PaperCode>--paper-text-size-0</PaperCode> through <PaperCode>--paper-text-size-17</PaperCode>) paired with specified typefaces (Nunito, Nunito Sans, and SUSE Mono).
                </PaperText>
            </PaperTextList>

            <PaperText id="tactile-elevation" preset="title">
                3. Tactile elevation and interaction
            </PaperText>
            <PaperText preset="body">
                Unlike flat or purely glassmorphic design languages, PaperUI incorporates tactile depth. Interactive elements such as buttons, selectors, and interactive groups exhibit physical displacement offsets and hard shadow dynamics via the <PaperLink href="/paperui/papereffect"><PaperCode>PaperEffect</PaperCode></PaperLink> primitive, visually signaling state upon user interaction.
            </PaperText>

            <PaperText id="composability" preset="title">
                4. Composability and template architecture
            </PaperText>
            <PaperText preset="body">
                PaperUI distinguishes between atomic <em>primitives</em> (such as <PaperLink href="/paperui/paperbutton"><PaperCode>PaperButton</PaperCode></PaperLink>, <PaperLink href="/paperui/paperinput"><PaperCode>PaperInput</PaperCode></PaperLink>, and <PaperLink href="/paperui/paperbadge"><PaperCode>PaperBadge</PaperCode></PaperLink>) and structural <em>templates</em> (such as <PaperLink href="/paperui/paperflex"><PaperCode>PaperFlex</PaperCode></PaperLink>, <PaperLink href="/paperui/paperwizard"><PaperCode>PaperWizard</PaperCode></PaperLink>, and <PaperLink href="/paperui/papersettinglist"><PaperCode>PaperSettingList</PaperCode></PaperLink>). Templates handle complex event delegation, layout calculations, and multi-step state workflows.
            </PaperText>

            <PaperSeparator />

            <PaperText id="architecture" preset="subheader">
                Library architecture
            </PaperText>
            <PaperText preset="body">
                The PaperUI package exports all component modules, template patterns, utility functions, and style sheets through a unified entrypoint. The typical structural hierarchy is depicted in the following schematic table:
            </PaperText>

            <PaperContainer>
                <PaperFlex padding="full" gap="half">
                    <PaperText size={3} weight={700}>PaperUI ecosystem layers</PaperText>
                    <PaperText size={2} color="var(--paper-light-text)">
                        1. Provider layer: <PaperCode>PaperProvider</PaperCode> manages application context, theme detection, and global body attributes.
                    </PaperText>
                    <PaperText size={2} color="var(--paper-light-text)">
                        2. Template layer: <PaperCode>PaperFlex</PaperCode>, <PaperCode>PaperWizard</PaperCode>, <PaperCode>PaperSettingList</PaperCode>, <PaperCode>PaperCenteredInterface</PaperCode>.
                    </PaperText>
                    <PaperText size={2} color="var(--paper-light-text)">
                        3. Primitive layer: Form controls, typography, navigation bars, modals, menus, and status indicators.
                    </PaperText>
                    <PaperText size={2} color="var(--paper-light-text)">
                        4. Token layer: Colors, typography scales, elevation filters, and scrollbar definitions in CSS.
                    </PaperText>
                </PaperFlex>
            </PaperContainer>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperui/quick-start">Quick start</PaperLink> — Installation and initial provider setup.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/theming">Theming and color modes</PaperLink> — Dynamic theme configuration and token resolution.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperprovider">PaperProvider</PaperLink> — Root provider component documentation.
                </PaperText>
            </PaperTextList>
        </>
    );
}
