import {
    PaperCode,
    PaperFlex,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";

export default function ShellApiDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">Shell API</PaperText>
            <PaperText preset="body">
                resolveOneShotShell resolves the platform-appropriate shell binary and base arguments for one-shot command execution.
                Reach for resolveOneShotShell when running terminal setup scripts or user-provided shell snippets.
                The utility provides consistent argument array structures across Windows, macOS, and Linux hosts.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Import resolveOneShotShell or detectHostPlatform from @mileniumhq/paperapi.
                Append your command string to baseArgs and pass the resulting array to processApi.run.
            </PaperText>
            <PaperCode block language="tsx">
{`import { resolveOneShotShell, processApi } from "@mileniumhq/paperapi";

const shell = resolveOneShotShell();
const args = [...shell.baseArgs, "echo $USER"];

const { stdout } = await processApi.exec(shell.command, args);
console.log(stdout);`}
            </PaperCode>

            <PaperText preset="subheader" id="methods-and-signatures">Methods and signatures</PaperText>
            <PaperText preset="body">
                The module exports the following platform resolution functions:
            </PaperText>

            <PaperTable>
                <thead>
                    <tr>
                        <th>Function</th>
                        <th>Signature</th>
                        <th>Description</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>resolveOneShotShell</PaperCode></td>
                        <td><PaperCode>resolveOneShotShell(platform?): OneShotShell</PaperCode></td>
                        <td>Returns the command string and baseArgs array for the detected or specified platform.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>detectHostPlatform</PaperCode></td>
                        <td><PaperCode>detectHostPlatform(): "win32" | "darwin" | "linux"</PaperCode></td>
                        <td>Detects the current host operating system platform without requiring Node typings.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                On Windows platforms, the resolver returns command: "cmd.exe" and baseArgs: ["/d", "/s", "/c"].
                On Linux, macOS, and unknown systems, it returns command: "sh" and baseArgs: ["-c"].
                The resolution guarantees array-based process spawning without string escaping issues.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Inspect host platform to conditionally adjust command parameters.
            </PaperText>
            <PaperCode block language="tsx">
{`import { detectHostPlatform } from "@mileniumhq/paperapi";

const platform = detectHostPlatform();
const clearCmd = platform === "win32" ? "cls" : "clear";`}
            </PaperCode>
        </PaperFlex>
    );
}
