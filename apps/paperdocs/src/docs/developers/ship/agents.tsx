import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

const PROMPT = `Build a Paperboard panel in this folder: <what the panel does, and for whom>.

Read these before you write code:
- https://paperboard.dev/llms.txt lists every page of the Paperboard docs. Each page is Markdown at its URL with .md in place of the trailing slash.
- https://paperboard.dev/docs/developers/first-panel.md, then the guide for each part the panel needs.
- The PaperAPI and PaperUI reference page of every API and component you use.

Rules:
- Make the panel with npm create @mileniumhq/panel and keep the scaffold's tests and preload.
- Build every page from PaperUI components and props. No inline styles and no CSS values of your own.
- Show every failure to the person, with the real reason, where they were looking. No placeholders in place of missing data.
- Keep keys, tokens and passwords in secretsApi, never in config, state, block inputs or logs.
- Never run code or commands the panel receives over the network.
- Never touch ~/.paperboard. Run a test Paperboard with its own data folder and set PAPERBOARD_DIR to it for every paperapi command.

When you finish, all of these pass, and you show me their output:
- bun run build
- bun test
- bunx paperapi doctor, ending with "Ready: Paperboard can run this panel."
- bunx paperapi call on each public block, with good input and with bad input
- the panel checklist at https://paperboard.dev/docs/developers/checklist.md, item by item`;

const TEST_PAPERBOARD = `# once, in the background
npx @mileniumhq/paperboard serve --headless --data-dir /tmp/pb-agent --port 47815 --host 127.0.0.1

# every command after it
export PAPERBOARD_DIR=/tmp/pb-agent
bunx paperapi link
bunx paperapi restart`;

const CHECK = `$ bunx paperapi doctor
dev.example.weather in .

  ✓ Manifest    Weather 0.2.0
  ✓ Build       dist/index.html, dist/service.js, dist/widget.html
  ✓ Link        /tmp/pb-agent/panels/dev.example.weather → .
  ✓ Paperboard  running at 127.0.0.1:47815, data in /tmp/pb-agent
  ✓ Service     answering

Ready: Paperboard can run this panel.

$ bunx paperapi call dev.example.weather command.follow-city '{"city":""}'
✗ dev.example.weather command.follow-city failed: Enter a city name
$ echo $?
1`;

const MONITOR = `$ timeout 10 bunx paperapi monitor --panel dev.example.weather --json
{"type":"rpc","at":1793802300891,"panel":null,"method":"blocks:call","target":"dev.example.weather","ms":0.2,"ok":true,"args":{"panelId":"dev.example.weather","entry":{"type":"string","size":17},"request":{"type":"object","keys":["inputs"]},"timeoutMs":30000}}`;

export default function AgentsGuideDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">Build with an agent</PaperText>
            <PaperText preset="body" as="p">
                A coding agent can build a panel from these docs, and check its own work with the same commands you use.
                This page gives it the docs, a prompt to start from, and the commands that show whether the panel works.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="docs-for-agents">The docs as Markdown</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>URL</th>
                        <th>What it holds</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>https://paperboard.dev/llms.txt</PaperCode></td><td>Every page of the docs, by section, with its first sentence and a link to its Markdown.</td></tr>
                    <tr><td><PaperCode>https://paperboard.dev/llms-full.txt</PaperCode></td><td>Every page in full, in one file, each marked with its source URL.</td></tr>
                    <tr><td>Any page with <PaperCode>.md</PaperCode> in place of the trailing slash</td><td>That page alone, such as <PaperCode>https://paperboard.dev/docs/developers/first-panel.md</PaperCode>.</td></tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                Give an agent <PaperCode>llms.txt</PaperCode> and let it fetch the pages it needs. <PaperCode>llms-full.txt</PaperCode> holds the whole of the docs, which fills much of an agent's context; use it only with an agent that can search a file.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="prompt">A prompt to start from</PaperText>
            <PaperText preset="body" as="p">
                Paste this into the agent, with the first line replaced by what your panel does:
            </PaperText>
            <PaperCode block language="text">{PROMPT}</PaperCode>
            <PaperTextList>
                <li>Name the panel's id and name in the first line if you have picked them, such as <PaperCode>dev.example.weather</PaperCode> and Weather.</li>
                <li>Say which services and accounts it uses, and where the agent gets a test key. Enter the key in the panel's own page in the test Paperboard yourself, so it goes to secretsApi and never into the chat or the code.</li>
                <li>Ask for one part at a time on a large panel: the service first, then the page, then blocks and widgets. The guides follow the same order.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="test-paperboard">Give it a test Paperboard</PaperText>
            <PaperText preset="body" as="p">
                An agent tries things that fail, restarts services and changes data. Keep it off your own Paperboard with a second one in a folder of its own, as in <PaperLink href="/docs/developers/dev-loop/#test-paperboard">Work on a second Paperboard</PaperLink>:
            </PaperText>
            <PaperCode block language="sh">{TEST_PAPERBOARD}</PaperCode>
            <PaperText preset="body" as="p">
                Every <PaperCode>paperapi</PaperCode> command then works on the test Paperboard. The scaffold's tests already use a throwaway folder of their own; see <PaperLink href="/docs/developers/testing/#real-data">Tests never reach your Paperboard</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="verify">How the agent checks its work</PaperText>
            <PaperText preset="body" as="p">
                Every check is a command with an exit code and text output, so an agent can run it and read the result:
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Command</th>
                        <th>What it proves</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>bun run build</PaperCode></td><td>The page, widgets and service compile, with no type errors.</td></tr>
                    <tr><td><PaperCode>bun test</PaperCode></td><td>The panel's rules hold, and no page has an inline style or a modal in the wrong place.</td></tr>
                    <tr><td><PaperCode>bunx paperapi doctor</PaperCode></td><td>The manifest is valid, the build is complete, the panel is linked, and its service answers. Each failed line says what to run next.</td></tr>
                    <tr><td><PaperCode>bunx paperapi call &lt;panel-id&gt;</PaperCode></td><td>Lists the panel's blocks. With a block's entry and JSON inputs, or a service call's name and JSON input, runs it and prints the result or the error.</td></tr>
                    <tr><td><PaperCode>bunx paperapi monitor --panel &lt;panel-id&gt; --json</PaperCode></td><td>Every call, event and service change of the panel, one JSON object per line.</td></tr>
                    <tr><td>The end-to-end tests</td><td>The blocks work through a running Paperboard. See <PaperLink href="/docs/developers/testing/#end-to-end">End-to-end tests</PaperLink>.</td></tr>
                </tbody>
            </PaperTable>
            <PaperCode block language="sh">{CHECK}</PaperCode>
            <PaperTextList>
                <li>A failed call exits with 1 and prints the block's own message. The call with an empty city has to fail with a sentence a person can act on: an agent that only tries good input never sees the failures.</li>
                <li><PaperCode>monitor</PaperCode> runs until it is stopped. Have the agent run it with a time limit, or in the background and stop it when it has what it needs, so the run never hangs on it.</li>
                <li><PaperCode>--json</PaperCode> sends only the records to standard output, and the <PaperCode>Watching</PaperCode> line to standard error, so the output parses line by line.</li>
            </PaperTextList>
            <PaperCode block language="sh">{MONITOR}</PaperCode>

            <PaperText preset="subheader" as="h2" id="review">What you check yourself</PaperText>
            <PaperText preset="body" as="p">
                Commands don't show how the panel looks or whether it makes sense to a person.
                Open every page and widget in Paperboard, in the light and the dark theme and in a narrow window, make every failure happen once, and go through the <PaperLink href="/docs/developers/checklist/">panel checklist</PaperLink>.
                Read the code before you install it anywhere but the test Paperboard: a panel runs with the full reach of your account.
            </PaperText>
        </PaperFlex>
    );
}
