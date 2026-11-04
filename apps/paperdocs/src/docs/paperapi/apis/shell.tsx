import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function ShellApiDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">resolveOneShotShell</PaperText>
            <PaperText preset="body" as="p">
                resolveOneShotShell names the system shell that runs one command line, with the arguments that go before it, for the computer the panel runs on.
                It is a plain function with no daemon call, so it works on a panel page, in a widget and in a service.
                Use it when a command line written by the person, such as a start-up script, has to run as one string.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperCode block language="tsx">
{`// in the service
import { processApi, resolveOneShotShell } from "@mileniumhq/paperapi";

const shell = resolveOneShotShell();
const result = await processApi.exec(shell.command, [...shell.baseArgs, settings.startScript]);
if (result.exitCode !== 0) throw new Error(\`Start script failed: \${result.stderr}\`);`}
            </PaperCode>
            <PaperText preset="body" as="p">
                The command line goes in as one argument after <PaperCode>baseArgs</PaperCode>. Nothing else parses it, so it needs no extra quoting.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="api">API</PaperText>
            <PaperCode block language="tsx">
{`resolveOneShotShell(platform?: string): OneShotShell;
detectHostPlatform(): HostPlatformName;

type HostPlatformName = "win32" | "darwin" | "linux";

interface OneShotShell {
    command: string;
    baseArgs: string[];
}`}
            </PaperCode>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Platform</th>
                        <th>command</th>
                        <th>baseArgs</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>"win32"</PaperCode></td>
                        <td><PaperCode>cmd.exe</PaperCode></td>
                        <td><PaperCode>["/d", "/s", "/c"]</PaperCode>: skip AutoRun, keep the command line's quotes as written, and run it.</td>
                    </tr>
                    <tr>
                        <td>Anything else</td>
                        <td><PaperCode>sh</PaperCode></td>
                        <td><PaperCode>["-c"]</PaperCode></td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="platform">Platform</PaperText>
            <PaperTextList>
                <li>With no <PaperCode>platform</PaperCode>, <PaperCode>resolveOneShotShell</PaperCode> uses <PaperCode>detectHostPlatform()</PaperCode>.</li>
                <li><PaperCode>detectHostPlatform</PaperCode> reads <PaperCode>process.platform</PaperCode> where the code runs. That is right in a service, which runs on the panel's computer.</li>
                <li>A panel page and a widget have no <PaperCode>process</PaperCode>, and there <PaperCode>detectHostPlatform</PaperCode> returns <PaperCode>"linux"</PaperCode> whatever the computer is. Pass the platform from <PaperLink href="/docs/paperapi/system/#api">systemApi.getInfo()</PaperLink> instead:</li>
            </PaperTextList>
            <PaperCode block language="tsx">
{`// on a panel page
import { resolveOneShotShell, systemApi } from "@mileniumhq/paperapi";

const { os } = await systemApi.getInfo();
const shell = resolveOneShotShell(os === "windows" ? "win32" : os);`}
            </PaperCode>
        </PaperFlex>
    );
}
