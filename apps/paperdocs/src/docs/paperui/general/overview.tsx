import { PaperCard, PaperCode, PaperFlex, PaperText } from "@paperboard-dev/paperui";

export default function PaperUiOverviewDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperUI</PaperText>
            <PaperText preset="body">
                PaperUI provides interface primitives, layout templates, and design tokens for SolidJS.
                Reach for PaperUI when building panel views, developer dashboards, or standalone web interfaces.
                The package couples theme management with accessible form controls and responsive layout containers.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                PaperUI separates layout structure, input controls, and surface styling into modular components.
                Every component consumes design tokens defined in CSS custom properties.
                The library supports light and dark themes through CSS variables without class switching on individual elements.
            </PaperText>

            <PaperText preset="subheader" id="package-structure">Package structure</PaperText>
            <PaperText preset="body">
                The package exports three categories of exports:
            </PaperText>
            <PaperCard padding="double" surface="front">
                <PaperFlex direction="column" gap="full">
                    <PaperText weight={700}>Components</PaperText>
                    <PaperText color="text-subtle">
                        Standard interactive controls such as buttons, inputs, toggles, menus, lists, and dialogs.
                    </PaperText>
                    <PaperText weight={700}>Templates</PaperText>
                    <PaperText color="text-subtle">
                        Structural layout containers such as PaperPanel, PaperPage, PaperFlex, and PaperSettingList.
                    </PaperText>
                    <PaperText weight={700}>Design tokens</PaperText>
                    <PaperText color="text-subtle">
                        CSS custom properties for surface tones, border contrast, typography scales, and animation timings.
                    </PaperText>
                </PaperFlex>
            </PaperCard>

            <PaperText preset="subheader" id="usage-example">Usage example</PaperText>
            <PaperText preset="body">
                Import the stylesheet once at the application entry point.
                Wrap the application tree in PaperProvider to establish theme inheritance.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperProvider, PaperCard, PaperButton, PaperText } from "@paperboard-dev/paperui";
import "@paperboard-dev/paperui/style.css";

export function App() {
    return (
        <PaperProvider theme="system" styleBody fullScreen>
            <PaperCard padding="double" surface="front">
                <PaperText preset="title">Dashboard</PaperText>
                <PaperButton variant="primary">Action</PaperButton>
            </PaperCard>
        </PaperProvider>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" id="style-isolation">Style isolation</PaperText>
            <PaperText preset="body">
                PaperUI styles elements scoped under the root selector.
                The library does not reset global document margins or mutate external tags outside its provider boundaries.
            </PaperText>
        </PaperFlex>
    );
}
