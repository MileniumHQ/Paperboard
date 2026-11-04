import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function DevLoopDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">The development loop</PaperText>
            <PaperText preset="body" as="p">
                Change the code, build, restart what changed, and check the result from the terminal or in Paperboard.
                The <PaperCode>paperapi</PaperCode> command does every step except the build, and its <PaperCode>doctor</PaperCode>, <PaperCode>monitor</PaperCode> and <PaperCode>call</PaperCode> commands show what the panel is doing.
                At the end of this page you know which command answers which question.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="before-you-start">Before you start</PaperText>
            <PaperText preset="body" as="p">
                A panel folder linked into a running Paperboard, as in <PaperLink href="/docs/guides/first-panel/">Your first panel</PaperLink>.
                Run every command below from the panel folder. The full reference is <PaperLink href="/docs/paperapi/cli/">paperapi</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="after-a-change">After a change</PaperText>
            <PaperText preset="body" as="p">
                Paperboard runs the files in <PaperCode>dist/</PaperCode>, so every change starts with <PaperCode>bun run build</PaperCode>. Then:
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>You changed</th>
                        <th>Then</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>The service</td>
                        <td><PaperCode>bunx paperapi restart</PaperCode>. It stops the service, starts the new build and waits until it is ready. Processes the service started keep running.</td>
                    </tr>
                    <tr>
                        <td>A page</td>
                        <td>In Paperboard, right-click the panel in the list and choose Restart Panel. It restarts the service and reloads the page.</td>
                    </tr>
                    <tr>
                        <td>The widget page</td>
                        <td>Restart Panel. A widget that failed to load shows its reason on Home with a Reload widget button.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>manifest.json</PaperCode></td>
                        <td><PaperCode>bunx paperapi doctor</PaperCode> to check it, then Restart Panel.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                Restart Panel is the one step that covers every case. <PaperCode>paperapi restart</PaperCode> is quicker when only the service changed and you are testing it from the terminal.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="doctor">When it doesn't run: doctor</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>bunx paperapi doctor</PaperCode> checks, in order, the manifest, the build, the link, the running Paperboard and the service.
                Each problem comes with the command that fixes it:
            </PaperText>
            <PaperCode block language="sh">
{`$ bunx paperapi doctor
dev.example.weather in .

  ✓ Manifest    Weather 0.1.0
  ✓ Build       dist/index.html, dist/service.js, dist/widget.html
  ✓ Link        /home/ada/.paperboard/panels/dev.example.weather → .
  ✓ Paperboard  running at 127.0.0.1:45464, data in /home/ada/.paperboard
  ✗ Service     not answering: it has registered nothing with Paperboard
                → paperapi restart starts it; paperapi monitor --panel dev.example.weather shows why it stops

1 problem.`}
            </PaperCode>
            <PaperTextList>
                <li>Run it first when the panel is missing from the list. Paperboard leaves out a panel whose manifest it refuses, and shows no message for it.</li>
                <li>The Build check warns when a file under <PaperCode>src/</PaperCode> changed after the last build: you are running old code.</li>
                <li>It exits 1 when any check fails, so a script can stop on it. <PaperCode>--json</PaperCode> prints the checks as one object.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="call">Try an action: call</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>bunx paperapi call &lt;panel-id&gt;</PaperCode> lists the panel's actions with their inputs.
                Add an action name and one JSON value to call it, as Paperboard and other panels do:
            </PaperText>
            <PaperCode block language="sh">
{`$ bunx paperapi call dev.example.weather follow-city '{"city":"Oslo"}'
✓ dev.example.weather follow-city · 1.5 ms
true

$ bunx paperapi call dev.example.weather follow-city '{"city":"Oslo"}'
✗ dev.example.weather follow-city failed: Weather already follows Oslo`}
            </PaperCode>
            <PaperTextList>
                <li>The result prints as JSON on standard output, so you can pipe it.</li>
                <li>A thrown error prints its message and the command exits 1. That message is exactly what the panel page, a flow, or an agent would see.</li>
                <li>The command calls as Paperboard itself, so it reaches internal actions too. <PaperCode>bunx paperapi call &lt;panel-id&gt; __getState</PaperCode> prints the service's whole state.</li>
                <li>A call waits 30 seconds. Pass <PaperCode>--timeout none</PaperCode> for an action that runs longer.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="monitor">See what happens: monitor</PaperText>
            <PaperText preset="body" as="p">
                Leave <PaperCode>bunx paperapi monitor --panel &lt;panel-id&gt;</PaperCode> running in a second terminal.
                It prints a line for every PaperAPI call the panel makes or receives, every event it sends, and every start, stop and crash of its service:
            </PaperText>
            <PaperCode block language="text">
{`05:54:57.678  host                      actions:call                         0.2 ms  ✗ INTERNAL Weather already follows Oslo  panelId=dev.example.weather action=follow-city args=[1] timeoutMs=30000
05:54:57.736  dev.example.weather       config:set                           0.3 ms  ok  id=dev.example.weather data={cities,units} duringCall=‹41 chars›
05:54:57.736  dev.example.weather       actions:emit                         0.0 ms  ok  event=__stateChanged payload={state} duringCall=‹41 chars›
05:54:57.736  dev.example.weather       secrets:get                          0.0 ms  ok  name=openweather-key duringCall=‹41 chars›
05:54:57.735  host                      actions:call                        11.5 ms  ok  panelId=dev.example.weather action=set-units args=[1] timeoutMs=30000
05:55:13.000  dev.example.weather       service stopped                   code null
05:55:13.000  dev.example.weather       service starting                  pid 2547010
05:55:13.061  dev.example.weather       service ready                     pid 2547010`}
            </PaperCode>
            <PaperTextList>
                <li>A button that does nothing shows here: either no call line appears, so the page never called, or a line with <PaperCode>✗</PaperCode> shows the call failed and why.</li>
                <li>A service that keeps crashing shows as <PaperCode>service exited</PaperCode> and <PaperCode>service starting</PaperCode> lines. Its own output is in the log, below.</li>
                <li>Only PaperAPI traffic shows. A <PaperCode>fetch</PaperCode> the service makes to a website does not, so log its failures and put them in the state.</li>
                <li><PaperCode>duringCall</PaperCode> marks a call the panel made while it was answering another, such as the <PaperCode>config:set</PaperCode> inside <PaperCode>set-units</PaperCode>.</li>
                <li>Secret values, file contents, config documents, action inputs and results never appear. <PaperLink href="/docs/paperapi/cli/#monitor-redaction">What the monitor shows</PaperLink> lists what does.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="logs">Read the service's output</PaperText>
            <PaperText preset="body" as="p">
                What the service writes with <PaperCode>console.log</PaperCode> and <PaperCode>console.error</PaperCode> goes to the Paperboard log, <PaperCode>logs/paperboard.log</PaperCode> in the data folder, with <PaperCode>[service:&lt;panel-id&gt;]</PaperCode> in front.
                Standard output is logged as <PaperCode>INFO</PaperCode> and standard error as <PaperCode>WARN</PaperCode>.
            </PaperText>
            <PaperCode block language="sh">
{`$ grep "service:dev.example.weather" ~/.paperboard/logs/paperboard.log
2026-11-04T13:50:48.333Z [WARN] [paperboard] [service:dev.example.weather] [weather] Oslo not refreshed: OpenWeather refused Oslo: Invalid API key.`}
            </PaperCode>
            <PaperText preset="body" as="p">
                Start every log line with the panel's short name, as <PaperCode>[weather]</PaperCode> does, so it can be found among the others.
                The log is for you. A person using the panel never reads it, so every failure that matters to them also goes to the page. See <PaperLink href="/docs/guides/errors/">Show every failure</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="test-paperboard">Work on a second Paperboard</PaperText>
            <PaperText preset="body" as="p">
                Every <PaperCode>paperapi</PaperCode> command works on the Paperboard whose data folder is in <PaperCode>PAPERBOARD_DIR</PaperCode>, or <PaperCode>~/.paperboard</PaperCode> when it is not set.
                To try a panel without touching your own Paperboard and its data, run a second Paperboard server daemon with its own data folder and port, and point the commands at it:
            </PaperText>
            <PaperCode block language="sh">
{`# terminal 1: a test daemon, reachable only from this computer
npx @mileniumhq/paperboard serve --headless --data-dir /tmp/pb-test --port 47815 --host 127.0.0.1

# terminal 2: the panel folder
export PAPERBOARD_DIR=/tmp/pb-test
bunx paperapi link
bunx paperapi restart
bunx paperapi doctor`}
            </PaperCode>
            <PaperText preset="body" as="p">
                The test daemon starts with no panels and no data. Stop it with Ctrl+C, and delete <PaperCode>/tmp/pb-test</PaperCode> to start again from nothing.
                The daemon's options are on the <PaperLink href="/docs/paperboard/daemon-cli/">server daemon reference</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="links">Manage links</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Command</th>
                        <th>What it does</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>bunx paperapi links</PaperCode></td><td>Lists the panels linked into this Paperboard and the folder each one points at.</td></tr>
                    <tr><td><PaperCode>bunx paperapi unlink &lt;panel-id&gt;</PaperCode></td><td>Removes a link. Your folder and the panel's data stay.</td></tr>
                    <tr><td><PaperCode>bunx paperapi link --force</PaperCode></td><td>Links this folder in place of an installed copy of the same panel. The installed copy's code is deleted. Its config, files and secrets stay.</td></tr>
                </tbody>
            </PaperTable>

            <PaperText preset="body" as="p">
                Next: <PaperLink href="/docs/guides/services/">keep state in a service</PaperLink>.
            </PaperText>
        </PaperFlex>
    );
}
