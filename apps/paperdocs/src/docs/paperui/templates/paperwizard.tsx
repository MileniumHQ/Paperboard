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
} from "@paperboard-dev/paperui";
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
                <strong>PaperWizard</strong> is a multi-step sequential wizard
                template managing step transitions, form state accumulation,
                animated step cards, progress calculation, and programmatic
                completion handlers.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                PaperWizard coordinates multi-stage onboarding,
                setup, and deployment procedures. It combines an animated step
                container with built-in navigation controls (Back/Next/Finish),
                progress bars, and reactive state management accessible to
                nested steps through the <PaperCode>useWizard()</PaperCode>{" "}
                context hook.
            </PaperText>

            <PaperSeparator />

            <PaperText id="usage" preset="subheader">
                Usage and demonstration
            </PaperText>
            <PaperText preset="body">
                Each child step is represented by a{" "}
                <PaperCode>PaperWizardStep</PaperCode> bearing a zero-indexed{" "}
                <PaperCode>index</PaperCode> prop. When the user navigates
                through the wizard, form data is automatically harvested upon
                step advancement:
            </PaperText>

            <PaperCode block language="tsx">
                {`import { PaperWizard, PaperWizardStep, PaperInput, PaperText, PaperFlex } from "@paperboard-dev/paperui";

function DeploymentWizard() {
    return (
        <PaperWizard
            showProgress
            finishVariant="green"
            onComplete={(data) => console.log("Final data:", data)}
        >
            <PaperWizardStep index={0}>
                <PaperFlex gap="half" center fullHeight fullWidth>
                    <PaperText preset="body">Enter the project identifier:</PaperText>
                    <PaperInput name="projectName" placeholder="my-app" />
                </PaperFlex>
            </PaperWizardStep>

            <PaperWizardStep index={1}>
                <PaperFlex gap="half" center fullHeight fullWidth>
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
                            <PaperWizardStep index={0}>
                                <PaperFlex
                                    gap="half"
                                    center
                                    fullHeight
                                    fullWidth
                                >
                                    <PaperText>
                                        Enter the application title:
                                    </PaperText>
                                    <PaperInput
                                        name="appTitle"
                                        defaultValue="Apollo Project"
                                        compact
                                    />
                                </PaperFlex>
                            </PaperWizardStep>

                            <PaperWizardStep index={1}>
                                <PaperFlex
                                    gap="half"
                                    center
                                    fullHeight
                                    fullWidth
                                >
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
                Wizard context API (<PaperCode>useWizard</PaperCode>)
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
                            <PaperCode>setCurrentStep(index)</PaperCode>
                        </td>
                        <td>
                            <PaperCode>(index: number) =&gt; void</PaperCode>
                        </td>
                        <td>
                            Jumps directly to the zero-indexed step number
                            without invoking <PaperCode>onStepChange</PaperCode>.
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>nextStep()</PaperCode>
                        </td>
                        <td>
                            <PaperCode>() =&gt; void</PaperCode>
                        </td>
                        <td>
                            Advances to the next step, or invokes{" "}
                            <PaperCode>onComplete</PaperCode> when on the final
                            step. Blocked while progression is disabled.
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>prevStep()</PaperCode>
                        </td>
                        <td>
                            <PaperCode>() =&gt; void</PaperCode>
                        </td>
                        <td>Returns to the previous step when not on step 0.</td>
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
                            <PaperCode>optionsShown()</PaperCode>
                        </td>
                        <td>
                            <PaperCode>() =&gt; boolean</PaperCode>
                        </td>
                        <td>
                            Returns whether the bottom navigation bar is
                            currently visible.
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
                    <tr>
                        <td>
                            <PaperCode>getStepData(key?)</PaperCode>
                        </td>
                        <td>
                            <PaperCode>(key?: string) =&gt; any</PaperCode>
                        </td>
                        <td>
                            Returns a single accumulated value by key, or the
                            full payload when no key is supplied.
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>isFirstStep()</PaperCode>
                        </td>
                        <td>
                            <PaperCode>() =&gt; boolean</PaperCode>
                        </td>
                        <td>Returns whether the active step is step 0.</td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>isLastStep()</PaperCode>
                        </td>
                        <td>
                            <PaperCode>() =&gt; boolean</PaperCode>
                        </td>
                        <td>
                            Returns whether the active step is the final
                            registered step.
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>registerStep(index)</PaperCode>
                        </td>
                        <td>
                            <PaperCode>(index: number) =&gt; void</PaperCode>
                        </td>
                        <td>
                            Registers a step position and grows the total step
                            count. Called automatically by{" "}
                            <PaperCode>PaperWizardStep</PaperCode>.
                        </td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="specification" preset="subheader">
                Technical specification
            </PaperText>

            <PaperText id="props-wizard" preset="title">
                PaperWizard props
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
                            <PaperCode>JSX.Element | string</PaperCode>
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
                            <PaperCode>nextLabel</PaperCode>
                        </td>
                        <td>
                            <PaperCode>JSX.Element | string</PaperCode>
                        </td>
                        <td>
                            <PaperCode>"Next"</PaperCode>
                        </td>
                        <td>
                            Text label on the advancement button for
                            non-final steps.
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>backLabel</PaperCode>
                        </td>
                        <td>
                            <PaperCode>JSX.Element | string</PaperCode>
                        </td>
                        <td>
                            <PaperCode>"Back"</PaperCode>
                        </td>
                        <td>
                            Text label on the back navigation button.
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>hideBack</PaperCode>
                        </td>
                        <td>
                            <PaperCode>boolean</PaperCode>
                        </td>
                        <td>
                            <PaperCode>false</PaperCode>
                        </td>
                        <td>
                            Hides the back navigation button, preventing
                            return to previous steps.
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

            <PaperText id="props-wizard-step" preset="title">
                PaperWizardStep props
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
                            <PaperCode>index</PaperCode>
                        </td>
                        <td>
                            <PaperCode>number</PaperCode>
                        </td>
                        <td>
                            <em>required</em>
                        </td>
                        <td>
                            Zero-indexed step position defining sequence order.
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>canProceed</PaperCode>
                        </td>
                        <td>
                            <PaperCode>boolean</PaperCode>
                        </td>
                        <td>
                            <PaperCode>true</PaperCode>
                        </td>
                        <td>
                            Whether the user can navigate forward from this step.
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <PaperCode>onStepActive</PaperCode>
                        </td>
                        <td>
                            <PaperCode>() =&gt; void</PaperCode>
                        </td>
                        <td>
                            <PaperCode>undefined</PaperCode>
                        </td>
                        <td>
                            Callback executed when this step becomes the active view.
                        </td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See also
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
