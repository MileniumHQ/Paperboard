import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function FirstPanelDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">Your first panel</PaperText>
            <PaperText preset="body" as="p">
                Make a panel with a page, a background service and a Home widget, run it in Paperboard, and add a block of your own.
                It takes about fifteen minutes.
                At the end you have a working panel folder and the commands you use every day to build on it.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="before-you-start">Before you start</PaperText>
            <PaperTextList>
                <li>Paperboard is installed and open on this computer. See <PaperLink href="/docs/paperboard/install/">Install Paperboard</PaperLink>.</li>
                <li><PaperLink href="https://bun.sh">Bun</PaperLink> is installed: <PaperCode>bun --version</PaperCode> prints a version.</li>
                <li>Node.js with npm is installed: <PaperCode>npm --version</PaperCode> prints a version.</li>
            </PaperTextList>
            <PaperText preset="body" as="p">
                Every command runs in a terminal on the same computer as Paperboard.
                The commands that talk to Paperboard find it through its data folder, <PaperCode>~/.paperboard</PaperCode>, or the folder in <PaperCode>PAPERBOARD_DIR</PaperCode> when it is set.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="make-the-panel">1. Make the panel</PaperText>
            <PaperText preset="body" as="p">
                Pick the folder that holds your projects, then run the panel maker. It asks about each choice.
            </PaperText>
            <PaperCode block language="sh">
{`npm create @mileniumhq/panel`}
            </PaperCode>
            <PaperText preset="body" as="p">
                Answer with the values below. Press Enter to take the value in brackets.
            </PaperText>
            <PaperCode block language="text">
{`Panel id (e.g. dev.paperboard.my-panel): dev.example.hello
Display name [Hello]:
Description [Hello panel]: Says hello to people by name
Publisher, credited on the library page (leave empty to set it later): Ada Lovelace

A background service keeps the panel's state and runs its work whether or not a window is open.
The Blocks panel and other panels use the blocks it offers. Without one, the panel is only UI.
Include a background service? [Y/n]:

A widget puts a small live tile from your panel on Paperboard's Home page.
Include a Home widget? [Y/n]:

A store listing is the long description on the panel's page in the panel library.
Include a store listing starter? [Y/n]:
Created 24 files in dev.example.hello/ (service, widget, store)`}
            </PaperCode>
            <PaperText preset="body" as="p">
                The panel id is the panel's identity everywhere, and it never changes after a release.
                Use reverse DNS for a name you control. The rules are on <PaperLink href="/docs/paperapi/manifest/#panel-id">Panel id</PaperLink>.
                For your own panel, use your own id. This tutorial uses <PaperCode>dev.example.hello</PaperCode> in every command.
            </PaperText>
            <PaperText preset="body" as="p">
                To answer everything on the command line instead, give the id and the name. Options go after <PaperCode>--</PaperCode>, so npm passes them on:
            </PaperText>
            <PaperCode block language="sh">
{`npm create @mileniumhq/panel dev.example.hello Hello -- --description "Says hello to people by name"`}
            </PaperCode>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Option</th>
                        <th>Effect</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>--description &lt;text&gt;</PaperCode></td><td>The one line under the name in the Panel Library. Default: <PaperCode>&lt;Name&gt; panel</PaperCode>.</td></tr>
                    <tr><td><PaperCode>--publisher &lt;name&gt;</PaperCode></td><td>Who the Panel Library credits. Default: none, and the manifest has no <PaperCode>publisher</PaperCode>.</td></tr>
                    <tr><td><PaperCode>--no-service</PaperCode></td><td>No background service, and so no widget either.</td></tr>
                    <tr><td><PaperCode>--no-widget</PaperCode></td><td>No Home widget.</td></tr>
                    <tr><td><PaperCode>--no-store</PaperCode></td><td>No <PaperCode>store/about.md</PaperCode> and no <PaperCode>store</PaperCode> entry in the manifest.</td></tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                The panel maker exits 1 when it can't make the panel, such as when the folder already exists, and 2 for a command line it can't read.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="build">2. Install and build</PaperText>
            <PaperCode block language="sh">
{`cd dev.example.hello
bun install
bun run build`}
            </PaperCode>
            <PaperText preset="body" as="p">
                The build type-checks the code, then writes three files Paperboard runs: <PaperCode>dist/index.html</PaperCode> (the panel page), <PaperCode>dist/widget.html</PaperCode> (the widget page) and <PaperCode>dist/service.js</PaperCode> (the service).
                It ends with these lines:
            </PaperText>
            <PaperCode block language="text">
{`✓ built in 166ms
Bundled 18 modules in 13ms

  service.js  143.50 KB  (entry point)`}
            </PaperCode>
            <PaperText preset="body" as="p">
                Run the tests the panel came with. They check the greeting rules and that no page sets an inline style.
            </PaperText>
            <PaperCode block language="sh">
{`$ bun test
 5 pass
 0 fail`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="link">3. Link it into Paperboard</PaperText>
            <PaperText preset="body" as="p">
                Linking tells Paperboard to run the panel from this folder, so every build you make is the one it runs.
            </PaperText>
            <PaperCode block language="sh">
{`$ bunx paperapi link
✓ Linked Hello (dev.example.hello)
/home/ada/.paperboard/panels/dev.example.hello → .
Paperboard serves its pages from this folder now. After a build, run paperapi restart to run the new service.`}
            </PaperCode>
            <PaperText preset="body" as="p">
                Paperboard starts a newly linked panel's service on its next restart. Start it now:
            </PaperText>
            <PaperCode block language="sh">
{`$ bunx paperapi restart
✓ Restarted dev.example.hello's service · ready in 73.2 ms`}
            </PaperCode>
            <PaperText preset="body" as="p">
                Then ask Paperboard whether it can run the panel:
            </PaperText>
            <PaperCode block language="sh">
{`$ bunx paperapi doctor
dev.example.hello in .

  ✓ Manifest    Hello 0.1.0
  ✓ Build       dist/index.html, dist/service.js, dist/widget.html
  ✓ Link        /home/ada/.paperboard/panels/dev.example.hello → .
  ✓ Paperboard  running at 127.0.0.1:45464, data in /home/ada/.paperboard
  ✓ Service     answering

Ready: Paperboard can run this panel.`}
            </PaperCode>
            <PaperText preset="body" as="p">
                A line with <PaperCode>✗</PaperCode> says what is wrong, and the line under it the command that fixes it. Run that command, then <PaperCode>bunx paperapi doctor</PaperCode> again.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="open">4. Open it in Paperboard</PaperText>
            <PaperText preset="body" as="p">
                In Paperboard, choose the computer in the left rail. Hello is in the list under This Computer, after Panel Library. Open it.
            </PaperText>
            <PaperTextList>
                <li><PaperCode>Counter</PaperCode> keeps a number that lives only as long as the window.</li>
                <li><PaperCode>Notes</PaperCode> saves a note in the panel's config, so it is still there after a restart.</li>
                <li><PaperCode>Service</PaperCode> asks the service to greet a name and shows how many greetings it has given.</li>
            </PaperTextList>
            <PaperText preset="body" as="p">
                On <PaperCode>Service</PaperCode>, type a name and press Greet. The page shows <PaperCode>Hello, Ada!</PaperCode> and the count goes up.
                Press Greet with the field empty: a red notice titled <PaperCode>Not greeted</PaperCode> says <PaperCode>Name is required</PaperCode>.
                That is the service's own error message, passed to the page unchanged.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="call">5. Call it from the terminal</PaperText>
            <PaperText preset="body" as="p">
                The service offers a Greet block, and anything can run a block: another panel, a flow in the Blocks panel, an agent, or you.
                With no name, <PaperCode>paperapi call</PaperCode> lists the panel's blocks:
            </PaperText>
            <PaperCode block language="sh">
{`$ bunx paperapi call dev.example.hello
1 block on dev.example.hello:
command.greet  Greet  (name: text)

$ bunx paperapi call dev.example.hello command.greet '{"name":"Grace"}'
✓ dev.example.hello command.greet · 0.9 ms
"Hello, Grace!"`}
            </PaperCode>
            <PaperText preset="body" as="p">
                The count on the open Service page goes up at the same moment. The service owns the count, and every window mirrors it.
                The Service page itself does not use the block. It asks the service with a call, <PaperCode>bridge.call("greet", name)</PaperCode>, which no other panel can make.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="add-a-block">6. Add a block</PaperText>
            <PaperText preset="body" as="p">
                Give the service a second block that sets the count back to zero, and a call so the page can use it.
                Replace <PaperCode>src/service.ts</PaperCode> with this. The new parts are the <PaperCode>resetGreetings</PaperCode> call and the <PaperCode>reset-greetings</PaperCode> block.
            </PaperText>
            <PaperCode block language="tsx">
{`import { blocksApi, definePanelService, type ServiceContext } from "@mileniumhq/paperapi";
import { buildGreeting } from "./lib/greet";
import { DEFAULT_STATE, PANEL_ID, type PanelState } from "./panel";

type Ctx = ServiceContext<PanelState>;

function greet(ctx: Ctx, name: unknown): string {
    const greeting = buildGreeting(name);
    ctx.setState({ greetingCount: ctx.state.greetingCount + 1 });
    return greeting;
}

function resetGreetings(ctx: Ctx): boolean {
    ctx.setState({ greetingCount: 0 });
    return true;
}

export default definePanelService({
    id: PANEL_ID,
    state: DEFAULT_STATE,
    // what the panel's own page asks
    calls: {
        greet: (ctx: Ctx, name?: unknown) => greet(ctx, name),
        resetGreetings: (ctx: Ctx) => resetGreetings(ctx),
    },
    async onInit(ctx) {
        // what the Blocks panel and other panels can use
        await blocksApi.panel(PANEL_ID).register({
            categories: [{ name: "General", icon: "star" }],
            commands: [
                {
                    id: "greet",
                    name: "Greet",
                    description: "Greets a person by name",
                    category: "General",
                    icon: "waving_hand",
                    text: "Greet {name}",
                    inputs: { name: { type: "text", name: "Name" } },
                    output: "text",
                    outputName: "Greeting",
                    run: (inputs: { name: string }) => greet(ctx, inputs.name),
                },
                {
                    id: "reset-greetings",
                    name: "Reset Greetings",
                    description: "Sets the greeting count back to zero",
                    category: "General",
                    icon: "restart_alt",
                    output: "boolean",
                    outputName: "Reset",
                    run: () => resetGreetings(ctx),
                },
            ],
        });
        console.log(\`[\${PANEL_ID}] service ready.\`);
    },
});`}
            </PaperCode>
            <PaperText preset="body" as="p">
                Then give the Service page a button for it. In <PaperCode>src/pages/ServicePage.tsx</PaperCode>, add this above the <PaperCode>return</PaperCode>:
            </PaperText>
            <PaperCode block language="tsx">
{`    const [resetFailure, setResetFailure] = createSignal("");
    const reset = async () => {
        setResetFailure("");
        try {
            await bridge.call<boolean>("resetGreetings");
        } catch (err) {
            console.error("[Service] reset failed:", err);
            setResetFailure(errorMessage(err));
        }
    };`}
            </PaperCode>
            <PaperText preset="body" as="p">
                Add the button after the Greet button:
            </PaperText>
            <PaperCode block language="tsx">
{`                            <PaperButton variant="text" onClick={() => void reset()}>
                                Reset count
                            </PaperButton>`}
            </PaperCode>
            <PaperText preset="body" as="p">
                And show its failure above the existing <PaperCode>{"<Show when={failure()}>"}</PaperCode> block, so a failed reset is never silent:
            </PaperText>
            <PaperCode block language="tsx">
{`                <Show when={resetFailure()}>
                    <PaperQuote variant="danger" icon="warning" title="Count not reset" role="alert" onDismiss={() => setResetFailure("")}>
                        {resetFailure()}
                    </PaperQuote>
                </Show>`}
            </PaperCode>
            <PaperText preset="body" as="p">
                The new count does not come back from the call. It arrives through the service's state, the same way a greeting from the terminal did.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="run-the-change">7. Run the change</PaperText>
            <PaperCode block language="sh">
{`$ bun run build
$ bunx paperapi restart
✓ Restarted dev.example.hello's service · ready in 58.6 ms

$ bunx paperapi call dev.example.hello command.reset-greetings
✓ dev.example.hello command.reset-greetings · 0.5 ms
true`}
            </PaperCode>
            <PaperText preset="body" as="p">
                <PaperCode>paperapi restart</PaperCode> runs the new service. The open window still shows the old page: right-click Hello in the list and choose Restart Panel, which restarts the service and reloads the page.
                The Service page now has a Reset count button.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="watch">8. Watch it work</PaperText>
            <PaperText preset="body" as="p">
                Open a second terminal in the panel folder and leave the monitor running:
            </PaperText>
            <PaperCode block language="sh">
{`bunx paperapi monitor --panel dev.example.hello`}
            </PaperCode>
            <PaperText preset="body" as="p">
                Press Greet in Paperboard, or run a block from the first terminal. Every call, event and service change prints one line, with its time and how it went:
            </PaperText>
            <PaperCode block language="text">
{`Watching calls involving dev.example.hello on Paperboard at 127.0.0.1:45464. Press Ctrl+C to stop.
05:40:12.875  dev.example.hello         blocks:emit                          0.2 ms  ok  panelId=dev.example.hello entry=‹25 chars› payload={state} duringCall=‹41 chars›
05:40:12.875  host                      blocks:call                          0.6 ms  ok  panelId=dev.example.hello entry=‹13 chars› request={inputs} timeoutMs=30000
05:40:12.938  host                      blocks:call                          0.2 ms  ✗ INTERNAL Name is required  panelId=dev.example.hello entry=‹13 chars› request={inputs} timeoutMs=30000
05:40:13.000  dev.example.hello         service stopped                   code null
05:40:13.000  dev.example.hello         service starting                  pid 2547010
05:40:13.061  dev.example.hello         service ready                     pid 2547010`}
            </PaperCode>
            <PaperText preset="body" as="p">
                <PaperCode>host</PaperCode> is Paperboard itself or the <PaperCode>paperapi</PaperCode> command. Press Ctrl+C to stop watching.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="what-you-have">What you have</PaperText>
            <PaperTextList>
                <li>A panel folder that builds, tests, and runs in Paperboard from where it is.</li>
                <li>A service with two blocks that the Blocks panel, other panels and agents can run, and calls for its own page.</li>
                <li>A Greetings widget, which Edit Home on the Home page offers under Hello.</li>
                <li>The daily loop: <PaperCode>bun run build</PaperCode>, <PaperCode>bunx paperapi restart</PaperCode>, Restart Panel, and <PaperCode>doctor</PaperCode>, <PaperCode>call</PaperCode> and <PaperCode>monitor</PaperCode> when something is off.</li>
            </PaperTextList>
            <PaperText preset="body" as="p">
                To take the link away again, run <PaperCode>bunx paperapi unlink dev.example.hello</PaperCode>. Your folder and the panel's saved data stay.
            </PaperText>

            <PaperText preset="body" as="p">
                Next: <PaperLink href="/docs/developers/anatomy/">what each file in the folder does</PaperLink>.
            </PaperText>
        </PaperFlex>
    );
}
