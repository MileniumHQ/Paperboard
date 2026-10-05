import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperText,
} from "@mileniumhq/paperui";

export default function DesignLanguageDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">Design language</PaperText>
            <PaperText preset="body">
                PaperUI defines visual hierarchy through surface luminance, uniform spacing steps, and semantic color roles.
                Reach for these layout patterns when designing views to maintain consistency across panels and standalone tools.
                The system emphasizes composition with structural templates rather than ad-hoc custom styles.
            </PaperText>

            <PaperText preset="subheader" id="surface-hierarchy">Surface hierarchy</PaperText>
            <PaperText preset="body">
                Elevation in PaperUI relies on background luminance rather than drop shadows.
                Higher surfaces display brighter tones in dark mode and cleaner tones in light mode.
                The surface progression ascends from application canvas to sunken wells, standard panels, and raised overlays.
            </PaperText>
            <PaperCard padding="double" surface="front">
                <PaperFlex direction="column" gap="full">
                    <PaperCard surface="back" padding="full">
                        <PaperText size={2} color="text-subtle">Surface: back</PaperText>
                    </PaperCard>
                    <PaperCard surface="front" padding="full">
                        <PaperText size={2} color="text-subtle">Surface: front</PaperText>
                    </PaperCard>
                    <PaperCard surface="frontest" padding="full">
                        <PaperText size={2} color="text-subtle">Surface: frontest</PaperText>
                    </PaperCard>
                </PaperFlex>
            </PaperCard>

            <PaperText preset="subheader" id="layout-and-spacing">Layout and spacing</PaperText>
            <PaperText preset="body">
                Layouts organize content with standard spacing increments derived from the base gap unit of 12 pixels.
                Use PaperFlex, PaperGrid, and PaperCard for structure instead of writing margin utilities.
                Standard containers expose padding and gap props that accept token identifiers: none, half, full, double, and triple.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperCard, PaperFlex, PaperText } from "@mileniumhq/paperui";

export function Section() {
    return (
        <PaperCard padding="double" gap="full" surface="front">
            <PaperText preset="title">Header</PaperText>
            <PaperText color="text-subtle">Body content</PaperText>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" id="styling-practices">Styling practices</PaperText>
            <PaperText preset="body">
                Avoid writing custom CSS classes or hardcoded color codes when standard components fulfill the requirement.
                Custom CSS styles are not banned when custom geometries or third-party containers demand specific CSS rules.
                When custom styles are necessary, reference PaperUI design tokens like var(--paper-surface-raised) and var(--paper-uigap).
            </PaperText>

            <PaperText preset="subheader" id="typography-and-contrast">Typography and contrast</PaperText>
            <PaperText preset="body">
                Text sizing follows discrete scales from index 0 through index 17.
                Primary text uses high contrast against the active surface, while secondary details use text-muted or text-subtle.
                Interactive elements maintain visible focus indicators using the primary accent color.
            </PaperText>
        </PaperFlex>
    );
}
