import {
    PaperButton,
    PaperCode,
    PaperContainer,
    PaperFlex,
    PaperIcon,
    PaperInput,
    PaperLink,
    PaperQuote,
    PaperSeparator,
    PaperTable,
    PaperText,
    PaperTextList,
    PaperWizard,
    PaperWizardStep,
    useWizard,
} from "paperui";
import { createSignal, Show } from "solid-js";

function WizardCompletionSummary(props: { data: Record<string, any> | null }) {
    return (
        <Show when={props.data}>
            <PaperQuote
                variant="green"
                icon="check_circle"
                title="Wizard Process Completed"
            >
                <PaperText preset="body">
                    Submitted payload: {JSON.stringify(props.data)}
                </PaperText>
            </PaperQuote>
        </Show>
    );
}

export default function f() {
    const [wizardResult, setWizardResult] = createSignal<Record<
        string,
        any
    > | null>(null);

    return (
        <>
            <PaperText preset="header">PaperWizard</PaperText>
            <PaperText preset="body">
                A multi-step sequential wizard template managing step
                transitions, form state accumulation, animated step cards,
                progress calculation, and programmatic completion handlers.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                <strong>PaperWizard</strong> coordinates multi-stage onboarding,
                setup, and deployment procedures. It combines an animated step
                container with built-in navigation controls (Back/Next/Finish),
                progress bars, and reactive state management accessible to
                nested steps through the <PaperCode>useWizard()</PaperCode>{" "}
                context hook.
            </PaperText>

            <PaperSeparator />

            <PaperText id="usage" preset="subheader">
                Usage and Demonstration
            </PaperText>
            <PaperText preset="body">
                Each child step is represented by a{" "}
                <PaperCode>PaperWizardStep</PaperCode> bearing a zero-indexed{" "}
                <PaperCode>index</PaperCode> prop. When the user navigates
                through the wizard, form data is automatically harvested upon
                step advancement:
            </PaperText>

            <PaperCode block language="tsx">
                {`import { PaperWizard, PaperWizardStep, PaperInput, PaperText, PaperFlex } from "paperui";

function DeploymentWizard() {
    return (
        <PaperWizard
            showProgress
            finishVariant="green"
            onComplete={(data) => console.log("Final data:", data)}
        >
            <PaperWizardStep index={0} title="Step 1: Project Details">
                <PaperFlex gap="half">
                    <PaperText preset="body">Enter the project identifier:</PaperText>
                    <PaperInput name="projectName" placeholder="my-app" />
                </PaperFlex>
            </PaperWizardStep>

            <PaperWizardStep index={1} title="Step 2: Environment">
                <PaperFlex gap="half">
                    <PaperText preset="body">Specify the deployment target:</PaperText>
                    <PaperInput name="environment" placeholder="production" />
                </PaperFlex>
            </PaperWizardStep>
        </PaperWizard>
    );
}`}
            </PaperCode>

            <PaperContainer>
                <PaperFlex padding="full" gap="full" center>
                    <PaperContainer
                        style={{
                            width: "100%",
                            "max-width": "540px",
                            height: "320px",
                            overflow: "hidden",
                        }}
                    >
                        <PaperWizard
                            showProgress
                            finishLabel="Submit"
                            finishVariant="green"
                            onComplete={(data) => setWizardResult(data)}
                        >
                            <PaperWizardStep
                                index={0}
                                title="1. Project Definition"
                            >
                                <PaperFlex gap="half" paddingY="half">
                                    <PaperText preset="body">
                                        Enter the application title:
                                    </PaperText>
                                    <PaperInput
                                        name="appTitle"
                                        defaultValue="Apollo Project"
                                        compact
                                    />
                                </PaperFlex>
                            </PaperWizardStep>

                            <PaperWizardStep
                                index={1}
                                title="2. Deployment Region"
                            >
                                <PaperFlex gap="half" paddingY="half">
                                    <PaperText preset="body">
                                        Specify target cloud region:
                                    </PaperText>
                                    <PaperInput
                                        name="region"
                                        defaultValue="us-east-1"
                                        compact
                                    />
                                </PaperFlex>
                            </PaperWizardStep>
                        </PaperWizard>
                    </PaperContainer>

                    <WizardCompletionSummary data={wizardResult()} />
                </PaperFlex>
            </PaperContainer>

            <PaperSeparator />

            <PaperText id="context-hook" preset="subheader">
                Wizard Context API (<PaperCode>useWizard</PaperCode>)
            </PaperText>
            <PaperText preset="body">
                Step components can access the wizard's state machine via{" "}
                <PaperCode>useWizard()</PaperCode> to gate progression or toggle
                navigation visibility during asynchronous operations:
            </PaperText>

            <PaperTable>
                <thead>
                    <tr>
                        <th>Method / Accessor</th>
                        <th>Type Signature</th>
                        <th>Description</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>
                            <PaperCode>currentStep()</PaperCode>
                        </td>
                        <td>
                            <PaperCode>() =&gt; number</PaperCode>
                        </td>
                        <td>Returns the active zero-indexed step number.</td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>totalSteps()</PaperCode>
                        </td>
                        <td>
                            <PaperCode>() =&gt; number</PaperCode>
                        </td>
                        <td>Returns the count of registered wizard steps.</td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>setCanProceed(canProceed)</PaperCode>
                        </td>
                        <td>
                            <PaperCode>
                                (canProceed: boolean) =&gt; void
                            </PaperCode>
                        </td>
                        <td>
                            Enables or disables the primary Next/Finish action
                            button.
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>setOptionsShown(show)</PaperCode>
                        </td>
                        <td>
                            <PaperCode>(show: boolean) =&gt; void</PaperCode>
                        </td>
                        <td>
                            Toggles visibility of the bottom button navigation
                            bar.
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>setStepData(keyOrObj, val?)</PaperCode>
                        </td>
                        <td>
                            <PaperCode>
                                (keyOrObject: string | object, value?: any)
                                =&gt; void
                            </PaperCode>
                        </td>
                        <td>
                            Manually writes state into the wizard accumulator
                            store.
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>getAllData()</PaperCode>
                        </td>
                        <td>
                            <PaperCode>
                                () =&gt; Record&lt;string, any&gt;
                            </PaperCode>
                        </td>
                        <td>Returns the complete accumulated form payload.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="specification" preset="subheader">
                Technical Specification
            </PaperText>

            <PaperText id="props-wizard" preset="title">
                PaperWizard Props
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
                        <td>
                            <PaperCode>initialData</PaperCode>
                        </td>
                        <td>
                            <PaperCode>Record&lt;string, any&gt;</PaperCode>
                        </td>
                        <td>
                            <PaperCode>&#123;&#125;</PaperCode>
                        </td>
                        <td>Initial pre-populated state for form fields.</td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>showProgress</PaperCode>
                        </td>
                        <td>
                            <PaperCode>boolean</PaperCode>
                        </td>
                        <td>
                            <PaperCode>true</PaperCode>
                        </td>
                        <td>
                            Renders a dynamic percentage progress bar above
                            navigation actions.
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>finishLabel</PaperCode>
                        </td>
                        <td>
                            <PaperCode>string</PaperCode>
                        </td>
                        <td>
                            <PaperCode>"Finish"</PaperCode>
                        </td>
                        <td>
                            Text label on the final step's confirmation button.
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>finishVariant</PaperCode>
                        </td>
                        <td>
                            <PaperCode>
                                "blue" | "green" | "yellow" | "red" | "brand"
                            </PaperCode>
                        </td>
                        <td>
                            <PaperCode>"green"</PaperCode>
                        </td>
                        <td>
                            Color variant applied to the final submission
                            button.
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>onComplete</PaperCode>
                        </td>
                        <td>
                            <PaperCode>
                                (data: Record&lt;string, any&gt;) =&gt; void
                            </PaperCode>
                        </td>
                        <td>
                            <PaperCode>undefined</PaperCode>
                        </td>
                        <td>
                            Callback invoked upon successful submission of the
                            final step.
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>onStepChange</PaperCode>
                        </td>
                        <td>
                            <PaperCode>
                                (step: number, data: object) =&gt; void
                            </PaperCode>
                        </td>
                        <td>
                            <PaperCode>undefined</PaperCode>
                        </td>
                        <td>
                            Callback executed whenever the active step
                            transitions.
                        </td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See Also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperloader">
                        PaperLoader
                    </PaperLink>{" "}
                    — Status and progress bar component for long-running wizard
                    tasks.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/papersettinglist">
                        PaperSettingList
                    </PaperLink>{" "}
                    — Single-screen configuration panel template.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/papercenteredinterface">
                        PaperCenteredInterface
                    </PaperLink>{" "}
                    — Centered container suitable for encapsulating wizards.
                </PaperText>
            </PaperTextList>
        </>
    );
}
