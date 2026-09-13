import {
    PaperButton,
    PaperCode,
    PaperContainer,
    PaperFlex,
    PaperLink,
    PaperProgress,
    PaperSeparator,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@paperboard-dev/paperui";
import { createSignal } from "solid-js";

export default function f() {
    const [progress, setProgress] = createSignal<number | undefined>(45);

    const toggleIndeterminate = () => {
        setProgress(progress() === undefined ? 50 : undefined);
    };

    return (
        <>
            <PaperText preset="header">PaperProgress</PaperText>
            <PaperText preset="body">
                <strong>PaperProgress</strong> is a linear progress bar component that mirrors the HTML <PaperCode>&lt;progress&gt;</PaperCode> interface while applying the Paper design system specifications, including borderless geometry, a track height of twice the thickest border width (<PaperCode>calc(var(--paper-thickest-border-width) * 2)</PaperCode>), and cubic-bezier percentage transitions.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                PaperProgress visualizes the quantitative completion status of deterministic tasks or communicates active processing for indeterminate background workloads. The component implements the WAI-ARIA progressbar design pattern (<PaperCode>role="progressbar"</PaperCode>) with matching ARIA state attributes.
            </PaperText>
            <PaperText preset="body">
                Unlike status trackers with lifecycle labels (such as <PaperLink href="/paperui/paperloader">PaperLoader</PaperLink>), PaperProgress functions as a plain progress bar suited to inline headers, dialog banners, taskbars, and updater overlays.
            </PaperText>

            <PaperSeparator />

            <PaperText id="usage" preset="subheader">
                Usage and demonstration
            </PaperText>
            <PaperText preset="body">
                The component accepts the numerical props <PaperCode>value</PaperCode> and optional <PaperCode>max</PaperCode> for determinate progress, or operates in an indeterminate mode when <PaperCode>value</PaperCode> is omitted:
            </PaperText>

            <PaperCode block language="tsx">
                {`import { PaperProgress } from "@paperboard-dev/paperui";

function DownloadStatus() {
    return (
        <>
            {/* Determinate progress */}
            <PaperProgress value={70} max={100} />

            {/* Indeterminate state */}
            <PaperProgress />
        </>
    );
}`}
            </PaperCode>

            <PaperContainer>
                <PaperFlex padding="full" gap="full" center>
                    <div style={{ width: "100%", "max-width": "480px" }}>
                        <PaperFlex gap="half">
                            <PaperFlex direction="row" justify="space-between">
                                <PaperText preset="caption">
                                    {progress() !== undefined
                                        ? `Download Progress: ${progress()}%`
                                        : "Connecting to server..."}
                                </PaperText>
                                <PaperText preset="caption">
                                    {progress() !== undefined ? `${progress()} / 100` : "Indeterminate"}
                                </PaperText>
                            </PaperFlex>
                            <PaperProgress value={progress()} max={100} />
                        </PaperFlex>
                    </div>

                    <PaperFlex direction="row" gap="half" wrap>
                        <PaperButton
                            variant="blue"
                            tiny
                            disabled={progress() === undefined}
                            onClick={() =>
                                setProgress((p) => Math.max(0, (p ?? 0) - 20))
                            }
                        >
                            -20%
                        </PaperButton>
                        <PaperButton
                            variant="blue"
                            tiny
                            disabled={progress() === undefined}
                            onClick={() =>
                                setProgress((p) => Math.min(100, (p ?? 0) + 20))
                            }
                        >
                            +20%
                        </PaperButton>
                        <PaperButton
                            variant="brand"
                            tiny
                            onClick={() => setProgress(100)}
                        >
                            100%
                        </PaperButton>
                        <PaperButton
                            variant="text"
                            tiny
                            onClick={toggleIndeterminate}
                        >
                            {progress() === undefined ? "Set Determinate" : "Set Indeterminate"}
                        </PaperButton>
                    </PaperFlex>
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
                        <td><PaperCode>value</PaperCode></td>
                        <td><PaperCode>number | undefined</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Current progress quantity. When undefined, the component displays an indeterminate animation.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>max</PaperCode></td>
                        <td><PaperCode>number</PaperCode></td>
                        <td><PaperCode>100</PaperCode></td>
                        <td>Upper numerical bound representing total completion.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode> / <PaperCode>classList</PaperCode></td>
                        <td><PaperCode>string | Record&lt;string, boolean&gt;</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Custom CSS classes applied to the root container.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>style</PaperCode></td>
                        <td><PaperCode>JSX.CSSProperties | string</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Inline CSS property declarations applied to the root element.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperloader">PaperLoader</PaperLink> — Radial progress and lifecycle status monitor.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperseparator">PaperSeparator</PaperLink> — Structural rule divider.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperbadge">PaperBadge</PaperLink> — Status indicator and compact label tag.
                </PaperText>
            </PaperTextList>
        </>
    );
}
