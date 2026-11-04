import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PaperApiCliDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">paperapi</PaperText>
            <PaperText preset="body" as="p">
                The paperapi command links a panel folder into Paperboard, checks it, calls its actions, watches its traffic, and packs it for release.
                It ships with <PaperCode>@mileniumhq/paperapi</PaperCode> and works on the data folder of the Paperboard you run on this computer.
                Use it for the whole development loop: link once, then build, restart, call and watch.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                Install the package in the panel, then run the command from the panel folder.
            </PaperText>
            <PaperCode block language="sh">
{`bun add -d @mileniumhq/paperapi
bunx paperapi link
bunx paperapi doctor`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="commands">Commands</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Command</th>
                        <th>Options</th>
                        <th>What it does</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>link [panel-dir]</PaperCode>, alias <PaperCode>dev-link</PaperCode></td>
                        <td><PaperCode>-f, --force</PaperCode></td>
                        <td>Links the folder (default: the current one) into Paperboard's panels folder, so Paperboard runs the panel from your working copy.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>unlink &lt;panel-id&gt;</PaperCode></td>
                        <td>None</td>
                        <td>Removes a development link. Never removes an installed panel.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>links</PaperCode>, alias <PaperCode>list-links</PaperCode></td>
                        <td><PaperCode>--json</PaperCode></td>
                        <td>Lists development links, and the ones whose folder is gone.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>doctor [panel-dir]</PaperCode></td>
                        <td><PaperCode>--json</PaperCode></td>
                        <td>Checks that Paperboard can run the panel folder, and says how to fix what stops it.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>monitor</PaperCode></td>
                        <td><PaperCode>-p, --panel &lt;panel-id&gt;</PaperCode>, <PaperCode>--json</PaperCode></td>
                        <td>Prints PaperAPI calls, events, service changes and process changes on this computer as they happen.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>call &lt;panel-id&gt; [action] [inputs]</PaperCode></td>
                        <td><PaperCode>-t, --timeout &lt;ms&gt;</PaperCode></td>
                        <td>Calls a panel's action and prints its result as JSON. With no action, lists the panel's actions.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>restart [panel]</PaperCode></td>
                        <td>None</td>
                        <td>Restarts a panel's service so it runs the latest build. Takes a panel folder or a panel id (default: the current folder).</td>
                    </tr>
                    <tr>
                        <td><PaperCode>pack [panel-dir]</PaperCode></td>
                        <td><PaperCode>-o, --out &lt;dir&gt;</PaperCode>, <PaperCode>--json</PaperCode></td>
                        <td>Builds the panel when its entry page is missing, then writes the release archive <PaperCode>out/&lt;id&gt;-&lt;version&gt;.tar.gz</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>help [command]</PaperCode></td>
                        <td>None</td>
                        <td>Prints the help of a command. Every command also takes <PaperCode>-h, --help</PaperCode>.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                <PaperCode>-V, --version</PaperCode> prints the package version.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="environment">Environment</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Variable</th>
                        <th>Default</th>
                        <th>What changes</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>PAPERBOARD_DIR</PaperCode></td>
                        <td><PaperCode>~/.paperboard</PaperCode></td>
                        <td>The Paperboard data folder every command works on: its <PaperCode>panels</PaperCode> folder for links, and <PaperCode>local/crane.json</PaperCode> to reach the running Paperboard. Set it to point the command at a second Paperboard, such as a test one.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>NO_COLOR</PaperCode></td>
                        <td>Not set</td>
                        <td>Any non-empty value turns color off.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>FORCE_COLOR</PaperCode></td>
                        <td>Not set</td>
                        <td>Any value except <PaperCode>0</PaperCode> turns color on, even when the output is not a terminal. <PaperCode>NO_COLOR</PaperCode> wins over it.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                With neither set, standard output and standard error are each colored only when they are a terminal.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="exit-codes">Exit codes</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Code</th>
                        <th>Meaning</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>0</PaperCode></td><td>The command did what it was asked.</td></tr>
                    <tr><td><PaperCode>1</PaperCode></td><td>It failed: Paperboard is not running, the action threw, <PaperCode>doctor</PaperCode> found a problem.</td></tr>
                    <tr><td><PaperCode>2</PaperCode></td><td>The command line is wrong: an unknown command or option, an invalid panel id, inputs that are not JSON, a bad timeout.</td></tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                A failure prints one line starting with <PaperCode>✗</PaperCode> on standard error, then an indented hint when there is a known fix.
            </PaperText>
            <PaperCode block language="sh">
{`$ bunx paperapi call dev.example.weather forecast '{city:"Oslo"}'
✗ The inputs are not JSON: JSON Parse error: Expected '}'
  Pass one JSON value, quoted for your shell: '{"name":"Ada"}', or '"text"' for a string.`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="connecting">How it reaches Paperboard</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>doctor</PaperCode>, <PaperCode>monitor</PaperCode>, <PaperCode>call</PaperCode> and <PaperCode>restart</PaperCode> read the port and the host token from <PaperCode>$PAPERBOARD_DIR/local/crane.json</PaperCode>, which the running Paperboard server daemon writes.
                They connect as the host, so they can call any panel's actions, internal ones too.
                Before sending the token, the command makes the listener prove it holds the same token, so a different program on that port never receives it.
                A daemon started with authentication off is refused.
            </PaperText>
            <PaperCode block language="sh">
{`$ bunx paperapi call dev.example.weather
✗ Paperboard isn't running: there is no /home/ada/.paperboard/local/crane.json
  Start Paperboard, or set PAPERBOARD_DIR to the data folder of the Paperboard you run.`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="link">link</PaperText>
            <PaperText preset="body" as="p">
                Reads <PaperCode>manifest.json</PaperCode> in the folder and creates the symbolic link <PaperCode>$PAPERBOARD_DIR/panels/&lt;id&gt;</PaperCode> pointing at it.
                The id must be a valid panel id. An existing link for the id is replaced.
            </PaperText>
            <PaperCode block language="sh">
{`$ bunx paperapi link
✓ Linked Weather (dev.example.weather)
/home/ada/.paperboard/panels/dev.example.weather → .
Paperboard serves its pages from this folder now. After a build, run paperapi restart to run the new service.`}
            </PaperCode>
            <PaperTextList>
                <li>An installed copy of the panel in that place is refused: <PaperCode>An installed copy of dev.example.weather already exists at /home/ada/.paperboard/panels/dev.example.weather. Use --force to replace it with this folder.</PaperCode></li>
                <li><PaperCode>--force</PaperCode> deletes the installed copy's code and links the folder in its place. The panel's config, files and secrets live elsewhere and stay.</li>
                <li>A folder without <PaperCode>manifest.json</PaperCode> fails with <PaperCode>No manifest.json found at &lt;folder&gt;. Cannot link non-panel directory.</PaperCode></li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="unlink">unlink</PaperText>
            <PaperCode block language="sh">
{`$ bunx paperapi unlink dev.example.weather
✓ Unlinked dev.example.weather

$ bunx paperapi unlink dev.example.weather
✗ dev.example.weather has no development link in /home/ada/.paperboard/panels
  paperapi links lists the ones there are.`}
            </PaperCode>
            <PaperText preset="body" as="p">
                An installed panel is refused with the hint <PaperCode>Uninstall an installed panel from Paperboard instead.</PaperCode>
            </PaperText>

            <PaperText preset="subheader" as="h2" id="links">links</PaperText>
            <PaperCode block language="sh">
{`$ bunx paperapi links
1 development link in /home/ada/.paperboard/panels:
dev.example.weather  → /home/ada/code/weather

$ bunx paperapi links --json
[{"id":"dev.example.weather","targetPath":"/home/ada/code/weather","isBroken":false}]`}
            </PaperCode>
            <PaperText preset="body" as="p">
                <PaperCode>isBroken</PaperCode> is true when the linked folder no longer exists. With no links, the command prints <PaperCode>No development links in &lt;panels folder&gt;.</PaperCode> and exits 0.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="doctor">doctor</PaperText>
            <PaperText preset="body" as="p">
                Runs five checks in order. Each one is <PaperCode>ok</PaperCode>, <PaperCode>warn</PaperCode>, <PaperCode>fail</PaperCode>, or <PaperCode>skip</PaperCode> when a check before it failed.
                The command exits 1 when any check fails. Warnings do not change the exit code.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Check</th>
                        <th>Fails when</th>
                        <th>Warns when</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>Manifest</td>
                        <td><PaperCode>manifest.json</PaperCode> is missing, not JSON, not an object, has an invalid id, has a <PaperCode>base</PaperCode> or <PaperCode>service</PaperCode> path that leaves the folder, or breaks a widget or tutorial rule.</td>
                        <td><PaperCode>name</PaperCode> or <PaperCode>version</PaperCode> is missing, which <PaperCode>pack</PaperCode> refuses.</td>
                    </tr>
                    <tr>
                        <td>Build</td>
                        <td>The entry page or the service file the manifest names is missing.</td>
                        <td>A file under <PaperCode>src/</PaperCode> changed after the last build.</td>
                    </tr>
                    <tr>
                        <td>Link</td>
                        <td>The panel is not linked, an installed copy is in the way, the link points at a folder that is gone, or it points at another folder.</td>
                        <td>Never.</td>
                    </tr>
                    <tr>
                        <td>Paperboard</td>
                        <td>No Paperboard is running on <PaperCode>PAPERBOARD_DIR</PaperCode>, or it refuses the host token.</td>
                        <td>Never.</td>
                    </tr>
                    <tr>
                        <td>Service</td>
                        <td>The manifest names a service that has registered nothing with Paperboard.</td>
                        <td>Never. Skipped for a panel without a service.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperCode block language="sh">
{`$ bunx paperapi doctor
dev.example.weather in .

  ✓ Manifest    Weather 1.0.0
  ✓ Build       dist/index.html, dist/service.js
  ✗ Link        not linked into /home/ada/.paperboard/panels
                → paperapi link
  ✗ Paperboard  isn't running: there is no /home/ada/.paperboard/local/crane.json
                → Start Paperboard, or set PAPERBOARD_DIR to the data folder of the Paperboard you run.
  - Service     needs a running Paperboard

2 problems.`}
            </PaperCode>
            <PaperCode block language="sh">
{`$ bunx paperapi doctor
  ✓ Manifest    Weather 1.0.0
  ✓ Build       dist/index.html, dist/service.js
  ✓ Link        /home/ada/.paperboard/panels/dev.example.weather → .
  ✓ Paperboard  running at 127.0.0.1:47911, data in /home/ada/.paperboard
  ✓ Service     answering, with 3 actions registered

Ready: Paperboard can run this panel.`}
            </PaperCode>
            <PaperText preset="body" as="p">
                <PaperCode>--json</PaperCode> prints one object. A check carries <PaperCode>fix</PaperCode> only when there is a known one.
            </PaperText>
            <PaperCode block language="json">
{`{
  "dir": "/home/ada/code/weather",
  "panel": "dev.example.weather",
  "checks": [
    { "name": "Manifest", "status": "ok", "detail": "Weather 1.0.0" },
    { "name": "Build", "status": "ok", "detail": "dist/index.html, dist/service.js" },
    { "name": "Link", "status": "ok", "detail": "/home/ada/.paperboard/panels/dev.example.weather → ." },
    { "name": "Paperboard", "status": "ok", "detail": "running at 127.0.0.1:47911, data in /home/ada/.paperboard" },
    { "name": "Service", "status": "ok", "detail": "answering, with 3 actions registered" }
  ],
  "problems": 0,
  "warnings": 0
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="call">call</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>inputs</PaperCode> is one JSON value, quoted for your shell. It reaches the action as its inputs.
                The result is printed as indented JSON on standard output, after a status line on standard error with the time the call took.
            </PaperText>
            <PaperCode block language="sh">
{`$ bunx paperapi call dev.example.weather
3 actions on dev.example.weather:
__getState  Get Panel State (internal)
forecast    Get forecast  (city: string)
save-key    Save API key  (key: string)

$ bunx paperapi call dev.example.weather forecast '{"city":"Oslo"}'
✓ dev.example.weather forecast · 1.3 ms
{
  "city": "Oslo",
  "high": 21,
  "low": 12
}

$ bunx paperapi call dev.example.weather nope
✗ dev.example.weather nope failed: Action "nope" on panel "dev.example.weather" is not registered or unavailable
  See what dev.example.weather offers: paperapi call dev.example.weather`}
            </PaperCode>
            <PaperText preset="body" as="p">
                <PaperCode>--timeout</PaperCode> takes a whole number of milliseconds from 1 to 60000, or <PaperCode>none</PaperCode> to wait for as long as the action runs. The default is 30000.
                Any other value exits 2 with <PaperCode>--timeout must be a whole number of milliseconds from 1 to 60000, or "none"</PaperCode>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="restart">restart</PaperText>
            <PaperText preset="body" as="p">
                Stops the panel's service and starts it from the current build, then waits until it is ready.
                Processes the service started keep running.
            </PaperText>
            <PaperCode block language="sh">
{`$ bunx paperapi restart
✓ Restarted dev.example.weather's service · ready in 64.5 ms

$ bunx paperapi restart dev.example.nothing
✗ dev.example.nothing's service did not restart: Panel dev.example.nothing is not installed
  Link it first: paperapi link`}
            </PaperCode>
            <PaperText preset="body" as="p">
                A panel folder whose manifest names no service fails with <PaperCode>&lt;panel&gt; has no service to restart</PaperCode>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="monitor">monitor</PaperText>
            <PaperText preset="body" as="p">
                Prints one line per call the daemon answers, per event it broadcasts, and per change of a service or a supervised process.
                The first column is the time, the second the panel that made the call, or <PaperCode>host</PaperCode> for Paperboard itself and this command.
                <PaperCode>--panel</PaperCode> keeps records the panel made, and calls that name it as their target.
            </PaperText>
            <PaperCode block language="sh">
{`$ bunx paperapi monitor
Watching every panel on Paperboard at 127.0.0.1:47911. Press Ctrl+C to stop.
04:50:13.009  host                      actions:call                         1.0 ms  ok  panelId=dev.example.weather action=forecast args=[1] timeoutMs=30000
04:50:13.010  dev.example.weather       event actions:dev.example.weather:__stateChanged  109 B → 0 sockets
04:50:13.048  dev.example.weather       secrets:set                          0.8 ms  ok  name=apiKey value=‹15 chars› duringCall=‹41 chars›
04:50:13.049  dev.example.weather       config:set                           0.6 ms  ok  id=dev.example.weather data={city,units} duringCall=‹41 chars›
04:50:13.089  dev.example.weather       service stopped                   code null
04:50:13.089  dev.example.weather       service starting                  pid 2510149
04:50:13.150  dev.example.weather       service ready                     pid 2510149`}
            </PaperCode>
            <PaperText preset="body" as="p">
                A failed call shows <PaperCode>✗</PaperCode>, its error code and its message in place of <PaperCode>ok</PaperCode>.
                A process line reads <PaperCode>process started</PaperCode> or <PaperCode>process exited</PaperCode> with the process id and exit code.
            </PaperText>

            <PaperText preset="subheader" as="h3" id="monitor-redaction">What the monitor shows of arguments</PaperText>
            <PaperText preset="body" as="p">
                The daemon never sends secret values, file contents, config documents, action inputs or results to the monitor.
                Arguments that name things are shown by value when they are a number, a boolean, null, or a string of at most 256 characters:
            </PaperText>
            <PaperCode block language="text">
{`panelId action event trigger project id name computerId packageName version
backupId sourceId destinationId downloadId appId signal cols rows timeoutMs
stdin consoleInput inputEncoding allowDowngrade deleteData targetPath path cwd command`}
            </PaperCode>
            <PaperText preset="body" as="p">
                Every other argument is shown by shape only: a string as <PaperCode>‹15 chars›</PaperCode>, an array as <PaperCode>[3]</PaperCode>, an object as its first 16 keys <PaperCode>{"{city,units}"}</PaperCode>.
                The credential and protocol version are left out. A record shows at most 32 arguments, and an error message at most 500 characters.
                <PaperCode>command</PaperCode> and <PaperCode>cwd</PaperCode> are shown by value, while the <PaperCode>args</PaperCode> and <PaperCode>env</PaperCode> of a process are not.
            </PaperText>

            <PaperText preset="subheader" as="h3" id="monitor-json">JSON records</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>--json</PaperCode> prints one record per line. <PaperCode>at</PaperCode> is epoch milliseconds and <PaperCode>panel</PaperCode> is <PaperCode>null</PaperCode> for the host.
            </PaperText>
            <PaperCode block language="json">
{`{"type":"rpc","at":1793796613048,"panel":"dev.example.weather","method":"secrets:set","target":"dev.example.weather","ms":0.8,"ok":true,"args":{"name":"apiKey","value":{"type":"string","size":15},"panelId":"dev.example.weather","duringCall":{"type":"string","size":41}}}
{"type":"service","panel":"dev.example.weather","state":"starting","pid":2510149,"at":1793796613089}`}
            </PaperCode>
            <PaperTable>
                <thead>
                    <tr>
                        <th><PaperCode>type</PaperCode></th>
                        <th>Fields</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>"rpc"</PaperCode></td>
                        <td><PaperCode>at</PaperCode>, <PaperCode>panel</PaperCode>, <PaperCode>method</PaperCode>, <PaperCode>target</PaperCode> (the panel named in the call's <PaperCode>panelId</PaperCode>, when there is one), <PaperCode>ms</PaperCode>, <PaperCode>ok</PaperCode>, <PaperCode>error</PaperCode>, <PaperCode>code</PaperCode>, <PaperCode>args</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>"event"</PaperCode></td>
                        <td><PaperCode>at</PaperCode>, <PaperCode>panel</PaperCode>, <PaperCode>event</PaperCode>, <PaperCode>bytes</PaperCode> (the event frame's size), <PaperCode>recipients</PaperCode> (sockets it reached).</td>
                    </tr>
                    <tr>
                        <td><PaperCode>"service"</PaperCode></td>
                        <td><PaperCode>at</PaperCode>, <PaperCode>panel</PaperCode>, <PaperCode>state</PaperCode> (<PaperCode>starting</PaperCode>, <PaperCode>ready</PaperCode>, <PaperCode>exited</PaperCode>, <PaperCode>stopped</PaperCode>, <PaperCode>failed</PaperCode>), <PaperCode>pid</PaperCode>, <PaperCode>code</PaperCode> (exit code, for exited and stopped), <PaperCode>error</PaperCode> (for failed).</td>
                    </tr>
                    <tr>
                        <td><PaperCode>"workload"</PaperCode></td>
                        <td><PaperCode>at</PaperCode>, <PaperCode>panel</PaperCode> (the owner), <PaperCode>id</PaperCode>, <PaperCode>state</PaperCode> (<PaperCode>started</PaperCode>, <PaperCode>exited</PaperCode>), <PaperCode>code</PaperCode>.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h3" id="monitor-lifetime">When the monitor stops</PaperText>
            <PaperTextList>
                <li>Only a connection holding this computer's host token may watch. The daemon refuses a panel credential.</li>
                <li>When Paperboard stops or restarts, the monitor prints <PaperCode>Paperboard went away (&lt;reason&gt;). Waiting for it to come back...</PaperCode>, retries every second, and prints <PaperCode>Watching again</PaperCode> once it is back.</li>
                <li>A monitor that reads too slowly is cut off by the daemon rather than fed a feed with holes in it. That, and a refused credential, end the command with <PaperCode>Paperboard ended the monitor: &lt;reason&gt;</PaperCode> and exit 1.</li>
                <li>Ctrl+C ends it with exit 0.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="pack">pack</PaperText>
            <PaperCode block language="sh">
{`$ bunx paperapi pack
Archiving manifest.json, dist...
✓ Packed dev.example.weather 1.0.0 · 35.0 KB
/home/ada/code/weather/out/dev.example.weather-1.0.0.tar.gz
sha256 08cad371ad5ed1e5b6b4b858859cb1cee5a7875b9ce6bb7e152f2428fe7c4eee`}
            </PaperCode>
            <PaperText preset="body" as="p">
                In order, the packer:
            </PaperText>
            <PaperTextList ordered>
                <li>Requires a valid <PaperCode>id</PaperCode>, a <PaperCode>name</PaperCode> and a <PaperCode>version</PaperCode>, and <PaperCode>unlisted</PaperCode> to be <PaperCode>true</PaperCode> or <PaperCode>false</PaperCode> when present.</li>
                <li>Checks <PaperCode>widgets</PaperCode> and <PaperCode>tutorial</PaperCode> with the same rules the daemon uses.</li>
                <li>Runs <PaperCode>bun run build</PaperCode> when the entry page (<PaperCode>base</PaperCode>, default <PaperCode>./dist/index.html</PaperCode>) is missing. The build's output goes to standard error.</li>
                <li>Refuses widgets without <PaperCode>dist/widget.html</PaperCode>, and tutorial images missing from <PaperCode>dist/</PaperCode>.</li>
                <li>Archives <PaperCode>manifest.json</PaperCode>, the folder holding <PaperCode>base</PaperCode>, <PaperCode>dist/</PaperCode>, and <PaperCode>branding/</PaperCode> (or <PaperCode>icon.png</PaperCode> when there is no <PaperCode>branding/</PaperCode>). Nothing else goes in: not <PaperCode>src/</PaperCode>, not <PaperCode>store/</PaperCode>, not <PaperCode>node_modules/</PaperCode>.</li>
            </PaperTextList>
            <PaperText preset="body" as="p">
                <PaperCode>--json</PaperCode> prints the release metadata: <PaperCode>id</PaperCode>, <PaperCode>name</PaperCode>, <PaperCode>version</PaperCode>, <PaperCode>description</PaperCode>, <PaperCode>archivePath</PaperCode>, <PaperCode>archiveName</PaperCode>, <PaperCode>sha256</PaperCode>, <PaperCode>sizeBytes</PaperCode> and the whole <PaperCode>manifest</PaperCode>.
                Two packs of the same files give different hashes.
            </PaperText>

            <PaperText preset="body" as="p">
                Next: <PaperLink href="/docs/paperapi/manifest/">the fields manifest.json takes</PaperLink>.
            </PaperText>
        </PaperFlex>
    );
}
