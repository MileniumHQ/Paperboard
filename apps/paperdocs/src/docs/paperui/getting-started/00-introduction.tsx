import {
    PaperCode,
    PaperContainer,
    PaperFlex,
    PaperLink,
    PaperQuote,
    PaperSeparator,
    PaperText,
    PaperTextList,
} from "paperui";

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

            <PaperQuote variant="blue" icon="info" title="Design System Scope">
                PaperUI is primarily tailored for Paperboard extension development and desktop-class web applications requiring cohesive visual hierarchy, elevation dynamics, and consistent typography.
            </PaperQuote>

            <PaperSeparator />

            <PaperText id="design-principles" preset="subheader">
                Design Principles
            </PaperText>
            <PaperText preset="body">
                The architecture of PaperUI adheres to four primary engineering and design principles:
            </PaperText>

            <PaperText id="fine-grained-reactivity" preset="title">
                1. Fine-Grained Reactivity
            </PaperText>
            <PaperText preset="body">
                PaperUI components leverage SolidJS reactive primitives—such as signals, memos, and effects—without an intermediate virtual DOM layer. Component instances execute their setup logic once, directly binding reactive expressions to DOM nodes. This approach minimizes memory consumption and delivers optimal performance during intensive UI state transitions.
            </PaperText>

            <PaperText id="systematic-tokenization" preset="title">
                2. Systematic Tokenization
            </PaperText>
            <PaperText preset="body">
                Visual aesthetics across PaperUI are governed strictly by standardized design tokens declared in CSS Custom Properties. Hard-coded dimension and color literals are discouraged across the ecosystem in favor of centralized variables governing:
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <strong>Surfaces and Color Semantics:</strong> Adaptive palettes conforming to light and dark modes via semantic tokens such as <PaperCode>--paper-background-front</PaperCode> and <PaperCode>--paper-front-blue</PaperCode>.
                </PaperText>
                <PaperText preset="body">
                    <strong>Spacing and Geometry:</strong> Proportional spacing multipliers scaled from <PaperCode>--paper-uigap</PaperCode> (12px base), alongside uniform border radii and border widths.
                </PaperText>
                <PaperText preset="body">
                    <strong>Typographic Hierarchy:</strong> Discrete sizing tokens (<PaperCode>--paper-text-size-0</PaperCode> through <PaperCode>--paper-text-size-17</PaperCode>) paired with specified typefaces (Nunito, Nunito Sans, and SUSE Mono).
                </PaperText>
            </PaperTextList>

            <PaperText id="tactile-elevation" preset="title">
                3. Tactile Elevation and Interaction
            </PaperText>
            <PaperText preset="body">
                Unlike flat or purely glassmorphic design languages, PaperUI incorporates tactile depth. Interactive elements such as buttons, selectors, and interactive groups exhibit physical displacement offsets and hard shadow dynamics via the <PaperLink href="/paperui/papereffect"><PaperCode>PaperEffect</PaperCode></PaperLink> primitive, visually signaling state upon user interaction.
            </PaperText>

            <PaperText id="composability" preset="title">
                4. Composability and Template Architecture
            </PaperText>
            <PaperText preset="body">
                PaperUI distinguishes between atomic <em>primitives</em> (such as <PaperLink href="/paperui/paperbutton"><PaperCode>PaperButton</PaperCode></PaperLink>, <PaperLink href="/paperui/paperinput"><PaperCode>PaperInput</PaperCode></PaperLink>, and <PaperLink href="/paperui/paperbadge"><PaperCode>PaperBadge</PaperCode></PaperLink>) and structural <em>templates</em> (such as <PaperLink href="/paperui/paperflex"><PaperCode>PaperFlex</PaperCode></PaperLink>, <PaperLink href="/paperui/paperwizard"><PaperCode>PaperWizard</PaperCode></PaperLink>, and <PaperLink href="/paperui/papersettinglist"><PaperCode>PaperSettingList</PaperCode></PaperLink>). Templates handle complex event delegation, layout calculations, and multi-step state workflows.
            </PaperText>

            <PaperSeparator />

            <PaperText id="architecture" preset="subheader">
                Library Architecture
            </PaperText>
            <PaperText preset="body">
                The PaperUI package exports all component modules, template patterns, utility functions, and style sheets through a unified entrypoint. The typical structural hierarchy is depicted in the following schematic table:
            </PaperText>

            <PaperContainer>
                <PaperFlex padding="full" gap="half">
                    <PaperText size={3} weight={700}>PaperUI Ecosystem Layers</PaperText>
                    <PaperText size={2} color="var(--paper-light-text)">
                        1. <strong>Provider Layer:</strong> <PaperCode>PaperProvider</PaperCode> manages application context, theme detection, and global body attributes.
                    </PaperText>
                    <PaperText size={2} color="var(--paper-light-text)">
                        2. <strong>Template Layer:</strong> <PaperCode>PaperFlex</PaperCode>, <PaperCode>PaperWizard</PaperCode>, <PaperCode>PaperSettingList</PaperCode>, <PaperCode>PaperCenteredInterface</PaperCode>.
                    </PaperText>
                    <PaperText size={2} color="var(--paper-light-text)">
                        3. <strong>Primitive Layer:</strong> Form controls, typography, navigation bars, modals, menus, and status indicators.
                    </PaperText>
                    <PaperText size={2} color="var(--paper-light-text)">
                        4. <strong>Token Layer:</strong> Colors, typography scales, elevation filters, and scrollbar definitions in CSS.
                    </PaperText>
                </PaperFlex>
            </PaperContainer>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See Also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperui/quick-start">Quick Start Guide</PaperLink> — Installation and initial provider setup.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/theming">Theming & Color Modes</PaperLink> — Dynamic theme configuration and token resolution.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperprovider">PaperProvider</PaperLink> — Root provider component documentation.
                </PaperText>
            </PaperTextList>
        </>
    );
}
