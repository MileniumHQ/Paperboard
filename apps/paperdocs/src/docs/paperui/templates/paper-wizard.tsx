import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperTable,
    PaperText,
    PaperWizard,
    PaperWizardStep,
} from "@mileniumhq/paperui";

export default function PaperWizardDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperWizard</PaperText>
            <PaperText preset="body">
                PaperWizard orchestrates multi-step guided workflows with integrated step validation and linear progress indicators.
                Reach for PaperWizard when building initial panel setup assistants, installation flows, or complex form questionnaires.
                The wizard coordinates data harvesting across steps and dispatches completion events.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Assemble step views using PaperWizardStep components inside PaperWizard.
                Receive harvested step data through the onComplete callback.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperWizard, PaperWizardStep, PaperCard, PaperText } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="front">
            <PaperWizard onComplete={(data) => console.log("Completed", data)}>
                <PaperWizardStep index={0} name="Welcome">
                    <PaperText preset="body">Welcome to the setup assistant.</PaperText>
                </PaperWizardStep>
                <PaperWizardStep index={1} name="Finish">
                    <PaperText preset="body">Setup complete. Click finish to activate.</PaperText>
                </PaperWizardStep>
            </PaperWizard>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperCard padding="double" surface="front">
                <PaperWizard onComplete={() => {}}>
                    <PaperWizardStep index={0} name="Welcome">
                        <PaperText preset="body">Welcome to the setup assistant.</PaperText>
                    </PaperWizardStep>
                    <PaperWizardStep index={1} name="Finish">
                        <PaperText preset="body">Setup complete. Click finish to activate.</PaperText>
                    </PaperWizardStep>
                </PaperWizard>
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperWizard accepts the following workflow properties:
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
                            <td><PaperCode>initialData</PaperCode></td>
                            <td><PaperCode>Record&lt;string, any&gt;</PaperCode></td>
                            <td><PaperCode>{}</PaperCode></td>
                            <td>Initial dictionary populated across wizard form fields.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>onComplete</PaperCode></td>
                            <td><PaperCode>(data: Record&lt;string, any&gt;) =&gt; void</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Invoked on the final step submission with all collected form values.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>onStepChange</PaperCode></td>
                            <td><PaperCode>(step: number, data: any) =&gt; void</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Invoked when transitioning forward or backward between steps.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>showProgress</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>true</PaperCode></td>
                            <td>Displays the linear progress bar along the bottom action row.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>finishLabel</PaperCode></td>
                            <td><PaperCode>string</PaperCode></td>
                            <td><PaperCode>"Finish"</PaperCode></td>
                            <td>Submit button text shown on the final step.</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                PaperWizard renders a form element and automatically harvests FormData values on step advance.
                Child components can inspect and modify wizard progress using the useWizard context hook.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Block forward progression until validation requirements are fulfilled using canProceed on PaperWizardStep.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperWizardStep index={0} canProceed={false}>
    <PaperText preset="body">You must check the agreement before proceeding.</PaperText>
</PaperWizardStep>`}
            </PaperCode>
        </PaperFlex>
    );
}
