import { createSignal } from "solid-js";
import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperInput,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
    PaperWizard,
    PaperWizardStep,
} from "@mileniumhq/paperui";

export default function PaperWizardDoc() {
    const [name, setName] = createSignal("");
    const [result, setResult] = createSignal("");

    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperWizard</PaperText>
            <PaperText preset="body" as="p">
                PaperWizard is a multi-step form: one step at a time, a Back and Next footer, and a progress indicator.
                Use it for setup flows and creation dialogs, where the user answers a few things in order and you act on all of the answers at the end.
                The footer's last Next becomes the finish button.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                Number each <PaperCode>PaperWizardStep</PaperCode> from 0 with <PaperCode>index</PaperCode> and name its fields.
                On every Next the wizard reads the named fields of the form into one record, and the last Next passes the record to <PaperCode>onComplete</PaperCode>.
                A wizard fills its parent, so give the parent a height: a modal, a pane, or a sized container.
                Moving between steps crossfades: the step leaving stays, inert, and fades where it stands while the next one slides in over it, so the wizard never shows an empty frame.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="back">
                <PaperFlex height="panel-height-small" fullWidth>
                    <PaperWizard
                        finishLabel="Create"
                        onComplete={(data) => setResult(JSON.stringify(data))}
                    >
                        <PaperWizardStep index={0} canProceed={name().length > 0}>
                            <PaperFlex padding="double" gap="full">
                                <PaperText preset="title" as="h2">Name</PaperText>
                                <PaperInput name="name" label="Name" fullWidth value={name()} onInput={(e) => setName(e.currentTarget.value)} />
                            </PaperFlex>
                        </PaperWizardStep>
                        <PaperWizardStep index={1}>
                            <PaperFlex padding="double" gap="full">
                                <PaperText preset="title" as="h2">Note</PaperText>
                                <PaperInput name="note" label="Note" fullWidth />
                            </PaperFlex>
                        </PaperWizardStep>
                    </PaperWizard>
                </PaperFlex>
                <PaperText preset="hint">{result() === "" ? "Not finished." : result()}</PaperText>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { createSignal } from "solid-js";
import { PaperFlex, PaperInput, PaperText, PaperWizard, PaperWizardStep } from "@mileniumhq/paperui";

export function Example() {
    const [name, setName] = createSignal("");

    return (
        <PaperWizard
            finishLabel="Create"
            onComplete={(data) => console.log(data)}
        >
            <PaperWizardStep index={0} canProceed={name().length > 0}>
                <PaperFlex padding="double" gap="full">
                    <PaperText preset="title" as="h2">Name</PaperText>
                    <PaperInput name="name" label="Name" fullWidth value={name()} onInput={(e) => setName(e.currentTarget.value)} />
                </PaperFlex>
            </PaperWizardStep>
            <PaperWizardStep index={1}>
                <PaperFlex padding="double" gap="full">
                    <PaperText preset="title" as="h2">Note</PaperText>
                    <PaperInput name="note" label="Note" fullWidth />
                </PaperFlex>
            </PaperWizardStep>
        </PaperWizard>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="subheader" as="h3" id="wizard-props">PaperWizard</PaperText>
            <PaperText preset="body" as="p">
                Extends <PaperCode>JSX.HTMLAttributes&lt;HTMLFormElement&gt;</PaperCode>. It renders a <PaperCode>form</PaperCode>.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Prop</th>
                        <th>Type</th>
                        <th>Default</th>
                        <th>Effect</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>initialData</PaperCode></td>
                        <td><PaperCode>Record&lt;string, any&gt;</PaperCode></td>
                        <td><PaperCode>{"{}"}</PaperCode></td>
                        <td>The record's starting values. Read once, when the wizard is created.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onComplete</PaperCode></td>
                        <td><PaperCode>(data: Record&lt;string, any&gt;) =&gt; void</PaperCode></td>
                        <td>No default</td>
                        <td>Called when the user passes the last step, with the whole record. It is not awaited: handle your own errors and show them.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onStepChange</PaperCode></td>
                        <td><PaperCode>(stepIndex: number, data: Record&lt;string, any&gt;) =&gt; void</PaperCode></td>
                        <td>No default</td>
                        <td>Called after a move to another step, forward or back, with the new index and the record.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>showProgress</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>true</PaperCode></td>
                        <td>Shows one dot per step in the footer. The dots are a progress bar for assistive technology: "Step 2 of 3".</td>
                    </tr>
                    <tr>
                        <td><PaperCode>hideBack</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (shown)</td>
                        <td>Never shows Back. A step can also hide it alone, with its own <PaperCode>hideBack</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>nextLabel</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td><PaperCode>"Next"</PaperCode></td>
                        <td>The label of the button on every step but the last.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>backLabel</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td><PaperCode>"Back"</PaperCode></td>
                        <td>The label of the Back button.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>finishLabel</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td><PaperCode>"Finish"</PaperCode></td>
                        <td>The label of the button on the last step.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>finishVariant</PaperCode></td>
                        <td><PaperCode>PaperButtonVariant</PaperCode></td>
                        <td><PaperCode>"success"</PaperCode></td>
                        <td>The variant of the last-step button, with the <PaperLink href="/docs/paperui/papereffect/">PaperEffect</PaperLink> shadow in the same color. A <PaperCode>surface</PaperCode>, <PaperCode>text</PaperCode> or <PaperCode>outline</PaperCode> variant gets a colorless shadow. Use <PaperCode>danger</PaperCode> when finishing destroys something.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h3" id="step-props">PaperWizardStep</PaperText>
            <PaperText preset="body" as="p">
                Extends <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode>. Place it directly in the wizard's children, always rendered: a step wrapped in a condition is not counted until it is shown.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Prop</th>
                        <th>Type</th>
                        <th>Default</th>
                        <th>Effect</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>index</PaperCode></td>
                        <td><PaperCode>number</PaperCode></td>
                        <td>Required</td>
                        <td>The step's position, from 0. The wizard has as many steps as the highest index plus one, so keep the numbers unbroken.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>name</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>A label for you. The wizard does not read it.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>canProceed</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (can proceed)</td>
                        <td>While <PaperCode>false</PaperCode> on the active step, Next (or Finish) is disabled and the step cannot be passed. It is reactive: pass an expression.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>hideBack</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (shown)</td>
                        <td>Hides Back while this step is active, for a step that cannot be undone, such as a finished download.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onStepActive</PaperCode></td>
                        <td><PaperCode>() =&gt; void</PaperCode></td>
                        <td>No default</td>
                        <td>Called when the step becomes the active one, including the first step on mount. It runs again whenever this step's <PaperCode>canProceed</PaperCode> changes while it is active, so keep it safe to repeat.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperText preset="subheader" as="h3" id="data">Collecting data</PaperText>
            <PaperText preset="body" as="p">
                Next is a submit button. Submitting reads the form with <PaperCode>FormData</PaperCode> and merges every named field into the record, replacing earlier keys of the same name, then moves on.
                Back reads the form the same way before it moves.
                Enter in a text field submits too.
            </PaperText>
            <PaperTextList>
                <li>A named checkbox, including a <PaperLink href="/docs/paperui/papertoggle/">PaperToggle</PaperLink>'s, gives its checked state as <PaperCode>true</PaperCode> or <PaperCode>false</PaperCode>. A disabled one is not read.</li>
                <li>Other field values are strings (or <PaperCode>File</PaperCode> objects). Convert numbers yourself.</li>
                <li>Only the active step is in the document, so only its fields are read. Earlier steps' values stay in the record.</li>
                <li>Values that are not form fields, such as a picked item, go in with <PaperCode>setStepData("key", value)</PaperCode> or <PaperCode>setStepData({"{ key: value }"})</PaperCode>.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="use-wizard">useWizard</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>useWizard()</PaperCode> returns the wizard's context inside it, and <PaperCode>undefined</PaperCode> outside.
                Use it for steps that drive the flow themselves, such as an install step that runs and then moves on.
            </PaperText>
            <PaperCode block language="tsx">
{`import { useWizard } from "@mileniumhq/paperui";
import type { WizardContextType } from "@mileniumhq/paperui";`}
            </PaperCode>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Member</th>
                        <th>Type</th>
                        <th>Effect</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>currentStep</PaperCode></td>
                        <td><PaperCode>() =&gt; number</PaperCode></td>
                        <td>The active step's index.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>totalSteps</PaperCode></td>
                        <td><PaperCode>() =&gt; number</PaperCode></td>
                        <td>The highest registered index plus one.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>isFirstStep</PaperCode>, <PaperCode>isLastStep</PaperCode></td>
                        <td><PaperCode>() =&gt; boolean</PaperCode></td>
                        <td>Whether the active step is the first or the last.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>nextStep</PaperCode></td>
                        <td><PaperCode>() =&gt; void</PaperCode></td>
                        <td>Moves forward, or calls <PaperCode>onComplete</PaperCode> on the last step. Does nothing while the active step's <PaperCode>canProceed</PaperCode> is false. It does not read the form: use it after storing data yourself.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>prevStep</PaperCode></td>
                        <td><PaperCode>() =&gt; void</PaperCode></td>
                        <td>Reads the form into the record, as the Back button does, and moves back. Does nothing on the first step.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>setCurrentStep</PaperCode></td>
                        <td><PaperCode>(index: number) =&gt; void</PaperCode></td>
                        <td>Jumps to a step. It skips the <PaperCode>canProceed</PaperCode> check and does not call <PaperCode>onStepChange</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>setStepData</PaperCode></td>
                        <td><PaperCode>(key: string, value: any) =&gt; void</PaperCode> or <PaperCode>(values: Record&lt;string, any&gt;) =&gt; void</PaperCode></td>
                        <td>Writes one key, or merges an object, into the record.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>getStepData</PaperCode></td>
                        <td><PaperCode>(key?: string) =&gt; any</PaperCode></td>
                        <td>One key of the record, or the whole record with no argument.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>getAllData</PaperCode></td>
                        <td><PaperCode>() =&gt; Record&lt;string, any&gt;</PaperCode></td>
                        <td>The whole record.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>setCanProceed</PaperCode></td>
                        <td><PaperCode>(value: boolean) =&gt; void</PaperCode></td>
                        <td>Sets whether the active step can be passed, from inside the step. A step's <PaperCode>canProceed</PaperCode> prop sets the same flag, and the active step resets it to its prop (or true) when it becomes active.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>setBackHidden</PaperCode></td>
                        <td><PaperCode>(hidden: boolean) =&gt; void</PaperCode></td>
                        <td>Hides or shows Back for the active step.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>optionsShown</PaperCode>, <PaperCode>setOptionsShown</PaperCode></td>
                        <td><PaperCode>() =&gt; boolean</PaperCode>, <PaperCode>(show: boolean) =&gt; void</PaperCode></td>
                        <td>Whether the footer is shown. Hiding it slides it away and disables its buttons, for a step that is working and must not be interrupted.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>registerStep</PaperCode></td>
                        <td><PaperCode>(index: number) =&gt; void</PaperCode></td>
                        <td>Called by each step on mount. You do not call it.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="in-a-modal">In a modal</PaperText>
            <PaperText preset="body" as="p">
                A creation dialog is a wizard inside an always-mounted <PaperLink href="/docs/paperui/papermodal/">PaperModal</PaperLink>.
                Remount the wizard each time the modal opens, so it starts at step 0 with empty fields.
            </PaperText>
            <PaperCode block language="tsx">
{`import { createSignal, Show } from "solid-js";
import {
    PaperButton,
    PaperFlex,
    PaperInput,
    PaperModal,
    PaperText,
    PaperWizard,
    PaperWizardStep,
} from "@mileniumhq/paperui";

export function CreateProject(props: { onCreate: (name: string) => Promise<void> }) {
    const [open, setOpen] = createSignal(false);
    const [failure, setFailure] = createSignal("");

    const finish = async (data: Record<string, any>) => {
        setFailure("");
        try {
            await props.onCreate(String(data.name));
            setOpen(false);
        } catch (err) {
            setFailure(err instanceof Error ? err.message : String(err));
        }
    };

    return (
        <>
            <PaperButton onClick={() => setOpen(true)}>New project</PaperButton>
            <PaperModal open={open()} onClose={() => setOpen(false)} title="New project">
                <Show when={open()}>
                    <PaperWizard finishLabel="Create" onComplete={(data) => void finish(data)}>
                        <PaperWizardStep index={0}>
                            <PaperFlex padding="double" gap="full">
                                <PaperInput name="name" label="Name" fullWidth required />
                                <Show when={failure()}>
                                    <PaperText preset="error">{failure()}</PaperText>
                                </Show>
                            </PaperFlex>
                        </PaperWizardStep>
                    </PaperWizard>
                </Show>
            </PaperModal>
        </>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="neighbors">Choosing a neighbor</PaperText>
            <PaperTextList>
                <li>Screens the user moves between freely are <PaperLink href="/docs/paperui/paperinterfacegroup/">PaperInterfaceGroup</PaperLink> items, not steps.</li>
                <li>A single short form belongs in a <PaperLink href="/docs/paperui/papermodal/">PaperModal</PaperLink> with its own footer buttons.</li>
                <li>The input each step collects is <PaperLink href="/docs/paperui/paperinput/">PaperInput</PaperLink>.</li>
            </PaperTextList>
        </PaperFlex>
    );
}
