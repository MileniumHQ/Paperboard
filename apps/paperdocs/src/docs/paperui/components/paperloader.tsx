import {
    PaperButton,
    PaperCode,
    PaperContainer,
    PaperFlex,
    PaperLink,
    PaperLoader,
    PaperLoaderGroup,
    PaperSeparator,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@paperboard-dev/paperui";
import { type LoaderStatus } from "@paperboard-dev/paperui";
import { createSignal } from "solid-js";

export default function f() {
    const [progress, setProgress] = createSignal(45);
    const [status, setStatus] = createSignal<LoaderStatus>("loading");

    const cycleStatus = () => {
        const next: Record<LoaderStatus, LoaderStatus> = {
            loading: "success",
            success: "error",
            error: "waiting",
            waiting: "loading",
        };
        setStatus(next[status()]);
    };

    return (
        <>
            <PaperText preset="header">PaperLoader</PaperText>
            <PaperText preset="body">
                <strong>PaperLoader</strong> is a circular progress indicator
                that renders a completion percentage as an SVG ring and
                communicates task state through arc color and status overlays.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                The component draws a ring inside a square SVG with a{" "}
                <PaperCode>viewBox</PaperCode> of{" "}
                <PaperCode>0 0 40 40</PaperCode>. Two arc paths share the same
                geometry: a background track stroked with{" "}
                <PaperCode>--paper-background-definition</PaperCode>, and a
                progress arc stroked with{" "}
                <PaperCode>--paper-front-blue</PaperCode>. The progress arc uses{" "}
                <PaperCode>stroke-dasharray</PaperCode> and{" "}
                <PaperCode>stroke-dashoffset</PaperCode> so that the visible
                portion of the ring corresponds to the percentage value, with
                transitions applied when the offset changes. An optional label
                is rendered beneath the ring through{" "}
                <PaperLink href="/paperui/papertext">PaperText</PaperLink>.
            </PaperText>

            <PaperSeparator />

            <PaperText id="usage" preset="subheader">
                Usage and demonstration
            </PaperText>
            <PaperText preset="body">
                The component accepts a numerical percentage (clamped to the
                range 0–100) and an active <PaperCode>loaderStatus</PaperCode>:
            </PaperText>

            <PaperCode block language="tsx">
                {`import { PaperLoader } from "@paperboard-dev/paperui";

function DeploymentTracker() {
    return (
        <PaperLoader
            percent={75}
            loaderStatus="loading"
            label="Deploying container artifacts..."
        />
    );
}`}
            </PaperCode>

            <PaperContainer>
                <PaperFlex padding="full" gap="full" center>
                    <div style={{ width: "100%", "max-width": "420px" }}>
                        <PaperLoader
                            percent={progress()}
                            loaderStatus={status()}
                            label={`Current status: ${status()} (${progress()}%)`}
                        />
                    </div>

                    <PaperFlex direction="row" gap="half">
                        <PaperButton
                            variant="blue"
                            tiny
                            onClick={() => setProgress(Math.max(0, progress() - 15))}
                        >
                            -15%
                        </PaperButton>
                        <PaperButton
                            variant="blue"
                            tiny
                            onClick={() => setProgress(Math.min(100, progress() + 15))}
                        >
                            +15%
                        </PaperButton>
                        <PaperButton variant="brand" tiny onClick={cycleStatus}>
                            Cycle Status
                        </PaperButton>
                    </PaperFlex>
                </PaperFlex>
            </PaperContainer>

            <PaperSeparator />

            <PaperText id="status-lifecycle" preset="subheader">
                Status lifecycle states
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Status</th>
                        <th>Arc Color Token</th>
                        <th>Visual Behavior</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>"loading"</PaperCode></td>
                        <td><PaperCode>--paper-front-blue</PaperCode></td>
                        <td>Blue arc sized proportionally to the percentage value.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>"waiting"</PaperCode></td>
                        <td><PaperCode>--paper-front-blue</PaperCode></td>
                        <td>The ring keeps its blue color while the entire loader is dimmed to opacity 0.5. No color change or pulsing occurs.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>"success"</PaperCode></td>
                        <td><PaperCode>--paper-front-green</PaperCode></td>
                        <td>The arc turns green and a circular overlay covers the ring with a white "check" Material Symbols glyph, entering with a scale-in animation followed by an expanding ripple outline.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>"error"</PaperCode></td>
                        <td><PaperCode>--paper-front-red</PaperCode></td>
                        <td>The arc turns red and a red circular overlay shows a white "close" glyph, entering with a bounce animation that briefly overshoots its final scale.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="loader-groups" preset="subheader">
                Loader groups
            </PaperText>
            <PaperText preset="body">
                <PaperCode>PaperLoaderGroup</PaperCode> arranges multiple loaders
                in a vertical flex layout separated by{" "}
                <PaperCode>--paper-uigap</PaperCode>. Its width follows the{" "}
                <PaperCode>--paper-loader-width</PaperCode> CSS variable, which
                lets several loaders share a common width:
            </PaperText>

            <PaperCode block language="tsx">
                {`<PaperLoaderGroup>
    <PaperLoader percent={80} loaderStatus="success" />
    <PaperLoader percent={45} loaderStatus="loading" label="Compiling shaders" />
</PaperLoaderGroup>`}
            </PaperCode>

            <PaperContainer>
                <PaperFlex padding="full" center>
                    <div style={{ width: "100%", "max-width": "420px" }}>
                        <PaperLoaderGroup>
                            <PaperLoader percent={80} loaderStatus="success" />
                            <PaperLoader
                                percent={45}
                                loaderStatus="loading"
                                label="Compiling shaders"
                            />
                        </PaperLoaderGroup>
                    </div>
                </PaperFlex>
            </PaperContainer>

            <PaperSeparator />

            <PaperText id="specification" preset="subheader">
                Technical specification
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Prop</th>
                        <th>Type</th>
                        <th>Default</th>
                        <th>Description</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>percent</PaperCode></td>
                        <td><PaperCode>number</PaperCode></td>
                        <td><em>Required</em></td>
                        <td>Completion percentage. Values are clamped to the range 0–100 before rendering, and falsy values are treated as 0.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>loaderStatus</PaperCode></td>
                        <td><PaperCode>"loading" | "waiting" | "success" | "error"</PaperCode></td>
                        <td><em>Required</em></td>
                        <td>Lifecycle state governing the arc color and any status overlay.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>label</PaperCode></td>
                        <td><PaperCode>string | JSX.Element</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Optional text or markup rendered beneath the ring as a size 4 PaperText element.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperprogress">PaperProgress</PaperLink> — Linear progress bar without lifecycle states.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperbadge">PaperBadge</PaperLink> — Compact status label.
                </PaperText>
            </PaperTextList>
        </>
    );
}
