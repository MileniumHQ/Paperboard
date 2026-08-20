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
} from "paperui";
import { type LoaderStatus } from "paperui";
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
                <strong>PaperLoader</strong> is a progress indicator and asynchronous task lifecycle monitor displaying percentage completion, status animations, and operational labels.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                <strong>PaperLoader</strong> communicates the progression of background operations, build pipelines, and asynchronous network requests. It combines an animated horizontal progress track with four semantic lifecycle states: <PaperCode>"loading"</PaperCode>, <PaperCode>"waiting"</PaperCode>, <PaperCode>"success"</PaperCode>, and <PaperCode>"error"</PaperCode>.
            </PaperText>

            <PaperSeparator />

            <PaperText id="usage" preset="subheader">
                Usage and Demonstration
            </PaperText>
            <PaperText preset="body">
                The component accepts a numerical percentage (0–100) and an active <PaperCode>loaderStatus</PaperCode>:
            </PaperText>

            <PaperCode block language="tsx">
                {`import { PaperLoader } from "paperui";

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
                Status Lifecycle States
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Status</th>
                        <th>Color Token</th>
                        <th>Visual Behavior</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>"loading"</PaperCode></td>
                        <td><PaperCode>--paper-front-blue</PaperCode></td>
                        <td>Active progressing blue bar with continuous shimmer animation.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>"waiting"</PaperCode></td>
                        <td><PaperCode>--paper-front-yellow</PaperCode></td>
                        <td>Indeterminate pulsing state awaiting external dependencies.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>"success"</PaperCode></td>
                        <td><PaperCode>--paper-front-green</PaperCode></td>
                        <td>Full-width green fill signaling operation completion.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>"error"</PaperCode></td>
                        <td><PaperCode>--paper-front-red</PaperCode></td>
                        <td>Full-width red fill indicating fatal pipeline exception.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="specification" preset="subheader">
                Technical Specification
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
                        <td>Progress percentage value between 0 and 100.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>loaderStatus</PaperCode></td>
                        <td><PaperCode>"loading" | "waiting" | "success" | "error"</PaperCode></td>
                        <td><em>Required</em></td>
                        <td>Lifecycle state governing track colors and animation modes.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>label</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Status message text rendered beneath the progress bar.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See Also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperwizard">PaperWizard</PaperLink> — Sequential wizard template integrating progress tracking.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperbadge">PaperBadge</PaperLink> — Compact status label.
                </PaperText>
            </PaperTextList>
        </>
    );
}
