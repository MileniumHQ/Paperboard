import * as fs from "fs";
import * as path from "path";
import { ensurePrivateDir, getLocalDir } from "./paths";
import { getDefaultShell } from "./util";

// Shell integration: a terminal's shell says where each prompt starts, which
// command it runs, how that command ended and which folder it is in, with
// the escape sequences terminals agree on (OSC 133 for prompts and commands,
// OSC 7 for the folder). Every terminal Paperboard starts gets it, so every
// panel that shows one can follow its commands.
//
// Each shell is started with a small script that loads the user's own
// startup files first, exactly as the shell would have, then adds the
// marks. A shell without a script here (sh, cmd) runs as it always did, and
// its terminal simply reports no commands.

const ESC = "\u001b";
const BEL = "\u0007";

export interface ShellLaunch {
    args: string[];
    env: Record<string, string>;
}

// ─── Which shells ───────────────────────────────────────────────────────────

export interface OfferedShell {
    /** the program, as a new terminal is started with it */
    path: string;
    /** what the user calls it */
    name: string;
}

/** the shell a terminal starts with when none is chosen */
export function defaultTerminalShell(): string {
    // platform-aware: a GUI app's $SHELL is not to be trusted on macOS, and
    // Windows' COMSPEC is cmd, which marks nothing
    return process.platform === "win32" ? "powershell.exe" : getDefaultShell();
}

// listed in /etc/shells but not a shell a person types into
const NOT_INTERACTIVE = new Set(["nologin", "false", "git-shell", "rbash", "systemd-home-fallback-shell", "screen", "tmux"]);

/** the shells this computer has, the default first */
export function offeredShells(): OfferedShell[] {
    const found: OfferedShell[] = [];
    const seen = new Set<string>();
    const offer = (file: string, name: string) => {
        let real: string;
        try {
            real = fs.realpathSync(file);
            if (!fs.statSync(real).isFile()) return;
        } catch {
            return; // listed but not installed
        }
        // /bin/bash and /usr/bin/bash are one shell on a merged /usr
        if (seen.has(real)) return;
        seen.add(real);
        found.push({ path: file, name });
    };
    if (process.platform === "win32") {
        const root = process.env.SystemRoot || "C:\\Windows";
        offer(path.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), "PowerShell");
        for (const dir of (process.env.PATH || "").split(path.delimiter)) {
            if (dir) offer(path.join(dir, "pwsh.exe"), "PowerShell 7");
        }
        offer(path.join(root, "System32", "cmd.exe"), "Command Prompt");
        for (const programs of [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]]) {
            if (programs) offer(path.join(programs, "Git", "bin", "bash.exe"), "Git Bash");
        }
        offer(path.join(root, "System32", "wsl.exe"), "WSL");
        return found;
    }
    offer(defaultTerminalShell(), path.basename(defaultTerminalShell()));
    let listed = "";
    try {
        listed = fs.readFileSync("/etc/shells", "utf8");
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    for (const line of listed.split("\n")) {
        const file = line.trim();
        if (!file.startsWith("/")) continue;
        const name = path.basename(file);
        if (NOT_INTERACTIVE.has(name)) continue;
        offer(file, name);
    }
    return found;
}

/** a shell a caller asked for, refused unless this computer offers it */
export function requireOfferedShell(shell: string): string {
    const offered = offeredShells();
    if (offered.some((s) => s.path === shell)) return shell;
    throw new Error(`${shell} is not a shell on this computer. Its shells are ${offered.map((s) => s.path).join(", ")}.`);
}

/** what kind of shell a program is, from its name; null when none we mark */
export function shellKind(shell: string): "bash" | "zsh" | "fish" | "powershell" | null {
    const name = path.basename(shell).toLowerCase().replace(/\.exe$/, "");
    if (name === "bash") return "bash";
    if (name === "zsh") return "zsh";
    if (name === "fish") return "fish";
    if (name === "pwsh" || name === "powershell") return "powershell";
    return null;
}

/** how to start a shell so it marks its prompts, commands and folder */
export function shellLaunch(shell: string, env: Record<string, string | undefined> = process.env): ShellLaunch {
    switch (shellKind(shell)) {
        case "bash":
        {
            // Git Bash on Windows reads a path with forward slashes
            const rcfile = writeScript("paperboard.bash", BASH);
            return { args: ["--rcfile", process.platform === "win32" ? rcfile.replace(/\\/g, "/") : rcfile], env: {} };
        }
        case "zsh": {
            const dir = path.dirname(writeScript(path.join("zsh", ".zshenv"), ZSHENV));
            writeScript(path.join("zsh", ".zshrc"), ZSHRC);
            return {
                args: [],
                env: {
                    ZDOTDIR: dir,
                    // the user's own folder, which the scripts hand back
                    PAPERBOARD_USER_ZDOTDIR: env.ZDOTDIR ?? "",
                    PAPERBOARD_USER_ZDOTDIR_SET: env.ZDOTDIR === undefined ? "0" : "1",
                },
            };
        }
        case "fish":
            // after the user's config.fish, before the first prompt
            return { args: ["--init-command", FISH], env: {} };
        case "powershell":
            // inline, not a script file: an execution policy that refuses
            // scripts (Windows' default) must not refuse the marks
            return { args: ["-NoLogo", "-NoExit", "-EncodedCommand", Buffer.from(POWERSHELL, "utf16le").toString("base64")], env: {} };
        default:
            return { args: [], env: {} };
    }
}

// written where only this user can read them, and rewritten when they differ
// from this build's, so an update's scripts replace an older build's
function writeScript(name: string, content: string): string {
    const file = path.join(getLocalDir(), "shell-integration", name);
    ensurePrivateDir(path.dirname(file));
    let current: string | null = null;
    try {
        current = fs.readFileSync(file, "utf8");
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    if (current !== content) fs.writeFileSync(file, content, { mode: 0o600 });
    return file;
}

// ─── What the shell says ────────────────────────────────────────────────────

export interface ShellCommand {
    /** the command line as typed; "" when the shell didn't say */
    command: string;
    exitCode: number;
}

export interface ShellMarkEvents {
    command?: (finished: ShellCommand) => void;
    cwd?: (cwd: string) => void;
}

// an unfinished sequence longer than this is not one a shell sends
const MAX_PENDING = 8192;

/**
 * Reads a terminal's output for the shell's marks. Output arrives in pieces,
 * so a sequence split across two is kept until it ends. A mark can come
 * twice (a shell that marks its own prompts, and our script): a command is
 * reported once, at its first end.
 */
export class ShellMarks {
    private pending = "";
    private running = false;
    private command = "";
    public cwd = "";

    constructor(private events: ShellMarkEvents, private readonly platform: NodeJS.Platform = process.platform) {}

    /** output seen before: its folder is taken, its commands are not reported again */
    replay(data: string): void {
        const events = this.events.command;
        this.events.command = undefined;
        try {
            this.feed(data);
        } finally {
            this.events.command = events;
        }
        // a command still running when the replay ends is reported when it ends
    }

    feed(data: string): void {
        let text = this.pending + data;
        this.pending = "";
        let at = 0;
        for (;;) {
            const start = text.indexOf(`${ESC}]`, at);
            if (start < 0) {
                // a sequence's first byte can end one piece
                if (text.endsWith(ESC)) this.pending = ESC;
                return;
            }
            const bel = text.indexOf(BEL, start + 2);
            const st = text.indexOf(`${ESC}\\`, start + 2);
            const end = bel < 0 ? st : st < 0 ? bel : Math.min(bel, st);
            if (end < 0) {
                const rest = text.slice(start);
                if (rest.length <= MAX_PENDING) this.pending = rest;
                return;
            }
            this.mark(text.slice(start + 2, end));
            at = end + (end === st ? 2 : 1);
        }
    }

    private mark(body: string): void {
        if (body.startsWith("7;")) {
            const cwd = fileUrlPath(body.slice(2), this.platform);
            if (cwd && cwd !== this.cwd) {
                this.cwd = cwd;
                this.events.cwd?.(cwd);
            }
            return;
        }
        if (!body.startsWith("133;")) return;
        const [kind, ...params] = body.slice(4).split(";");
        if (kind === "C") {
            if (!this.running) this.command = "";
            this.running = true;
            for (const param of params) {
                if (!param.startsWith("cmdline_url=")) continue;
                const line = decode(param.slice("cmdline_url=".length));
                if (line !== null && line.trim()) this.command = line.trim();
            }
        } else if (kind === "D") {
            if (!this.running) return;
            this.running = false;
            const code = Number.parseInt(params[0] ?? "", 10);
            this.events.command?.({ command: this.command, exitCode: Number.isFinite(code) ? code : 0 });
            this.command = "";
        }
    }
}

function decode(text: string): string | null {
    try {
        return decodeURIComponent(text);
    } catch {
        return null;
    }
}

// file://host/path → the path; a Windows path arrives as /C:/Users/...
function fileUrlPath(url: string, platform: NodeJS.Platform): string | null {
    if (!url.startsWith("file://")) return null;
    const slash = url.indexOf("/", "file://".length);
    if (slash < 0) return null;
    const decoded = decode(url.slice(slash));
    if (!decoded) return null;
    if (platform === "win32") {
        const drive = /^\/+([A-Za-z]:)(.*)$/.exec(decoded);
        if (!drive) return null;
        return (drive[1] + (drive[2] || "/")).replace(/\//g, "\\");
    }
    return decoded;
}

// ─── The scripts ────────────────────────────────────────────────────────────

const BASH = String.raw`# Paperboard shell integration for bash. Loads the user's ~/.bashrc as an
# interactive shell would, then marks prompts and commands (OSC 133) and the
# folder (OSC 7).
if [ -r "$HOME/.bashrc" ]; then . "$HOME/.bashrc"; fi

if [ -z "${"$"}{__pb_loaded:-}" ]; then
__pb_loaded=1
__pb_running=0
__pb_ready=0
__pb_status=0
__pb_histnum=

__pb_osc() { builtin printf '\033]%s\007' "$1"; }

__pb_urlencode() {
    local LC_ALL=C s="$1" out= c i
    for (( i = 0; i < ${"$"}{#s}; i++ )); do
        c="${"$"}{s:i:1}"
        case "$c" in
            [a-zA-Z0-9/._~-]) out+="$c" ;;
            *) builtin printf -v c '%%%02X' "'$c"; out+="$c" ;;
        esac
    done
    builtin printf '%s' "$out"
}

__pb_history() {
    local line
    line=$(HISTTIMEFORMAT= builtin history 1)
    if [[ "$line" =~ ^[[:space:]]*([0-9]+)[*]?[[:space:]]+(.*)$ ]]; then
        __pb_line_num="${"$"}{BASH_REMATCH[1]}"
        __pb_line="${"$"}{BASH_REMATCH[2]}"
    else
        __pb_line_num=
        __pb_line=
    fi
}

# a command is about to run: the first one after a prompt
__pb_command_start() {
    __pb_ready=0
    __pb_running=1
    __pb_osc "133;C;cmdline_url=$(__pb_urlencode "$1")"
}

# the prompt is about to show: the last command ended with $1
__pb_prompt() {
    if [ "$__pb_running" = 1 ]; then
        __pb_osc "133;D;$1"
        __pb_running=0
    fi
    __pb_osc "7;file://${"$"}{HOSTNAME}$(__pb_urlencode "$PWD")"
    if [[ "$PS1" != *'133;A'* ]]; then PS1='\[\033]133;A\007\]'"$PS1"; fi
}

if [ -n "${"$"}{bash_preexec_imported:-}${"$"}{__bp_imported:-}" ]; then
    # bash-preexec owns the hooks: join them
    __pb_bp_preexec() { __pb_command_start "$1"; }
    __pb_bp_precmd() { __pb_prompt "$?"; }
    preexec_functions+=(__pb_bp_preexec)
    precmd_functions+=(__pb_bp_precmd)
else
    __pb_front() { __pb_status=$?; __pb_ready=0; return $__pb_status; }
    __pb_back() {
        __pb_prompt "$__pb_status"
        __pb_history
        __pb_histnum="$__pb_line_num"
        __pb_ready=1
        return $__pb_status
    }
    __pb_debug() {
        [ "$__pb_ready" = 1 ] || return 0
        [ -n "${"$"}{COMP_LINE:-}" ] && return 0
        # an empty line runs nothing; the prompt's own command comes first
        case "$BASH_COMMAND" in __pb_front*) __pb_ready=0; return 0 ;; esac
        __pb_history
        # a line the history didn't keep (ignorespace) is not named
        if [ "$__pb_line_num" != "$__pb_histnum" ]; then
            __pb_command_start "$__pb_line"
        else
            __pb_command_start ""
        fi
    }
    __pb_user_trap=
    __pb_existing=$(builtin trap -p DEBUG)
    if [ -n "$__pb_existing" ]; then
        __pb_take() { __pb_user_trap="$3"; }
        eval "__pb_take ${"$"}{__pb_existing#trap }"
        unset -f __pb_take
    fi
    unset __pb_existing
    builtin trap '__pb_debug; if [ -n "$__pb_user_trap" ]; then eval "$__pb_user_trap"; fi' DEBUG
    if [[ "$(declare -p PROMPT_COMMAND 2>/dev/null)" == "declare -a"* ]]; then
        PROMPT_COMMAND=(__pb_front "${"$"}{PROMPT_COMMAND[@]}" __pb_back)
    else
        PROMPT_COMMAND="__pb_front${"$"}{PROMPT_COMMAND:+; $PROMPT_COMMAND}; __pb_back"
    fi
fi
fi
`;

// zsh reads its startup files from ZDOTDIR: ours point it back at the
// user's folder while each of the user's files runs
const ZSHENV = String.raw`# Paperboard shell integration for zsh: the user's own .zshenv
__pb_zdotdir="$ZDOTDIR"
if [[ "$PAPERBOARD_USER_ZDOTDIR_SET" == 1 ]]; then ZDOTDIR="$PAPERBOARD_USER_ZDOTDIR"; else ZDOTDIR="$HOME"; fi
if [[ -f "$ZDOTDIR/.zshenv" ]]; then builtin source "$ZDOTDIR/.zshenv"; fi
# a .zshenv can choose another folder for the rest
if [[ "$ZDOTDIR" != "$HOME" || "$PAPERBOARD_USER_ZDOTDIR_SET" == 1 ]]; then
    PAPERBOARD_USER_ZDOTDIR="$ZDOTDIR"
    PAPERBOARD_USER_ZDOTDIR_SET=1
fi
if [[ -o interactive ]]; then
    ZDOTDIR="$__pb_zdotdir"
else
    # a script reads no .zshrc: hand everything back now
    if [[ "$PAPERBOARD_USER_ZDOTDIR_SET" == 1 ]]; then ZDOTDIR="$PAPERBOARD_USER_ZDOTDIR"; else unset ZDOTDIR; fi
    unset PAPERBOARD_USER_ZDOTDIR PAPERBOARD_USER_ZDOTDIR_SET
fi
unset __pb_zdotdir
`;

const ZSHRC = String.raw`# Paperboard shell integration for zsh: the user's own .zshrc, then the marks
if [[ "$PAPERBOARD_USER_ZDOTDIR_SET" == 1 ]]; then ZDOTDIR="$PAPERBOARD_USER_ZDOTDIR"; else unset ZDOTDIR; fi
unset PAPERBOARD_USER_ZDOTDIR PAPERBOARD_USER_ZDOTDIR_SET
if [[ -f "${"$"}{ZDOTDIR:-$HOME}/.zshrc" ]]; then builtin source "${"$"}{ZDOTDIR:-$HOME}/.zshrc"; fi

if [[ -z "${"$"}{__pb_loaded:-}" ]]; then
__pb_loaded=1
__pb_running=0

__pb_osc() { builtin printf '\033]%s\007' "$1"; }

__pb_urlencode() {
    emulate -L zsh
    local LC_ALL=C s="$1" out= c
    local i
    for (( i = 1; i <= ${"$"}{#s}; i++ )); do
        c="${"$"}{s[i]}"
        if [[ "$c" == [a-zA-Z0-9/._~-] ]]; then out+="$c"; else builtin printf -v c '%%%02X' "'$c"; out+="$c"; fi
    done
    builtin print -rn -- "$out"
}

__pb_precmd() {
    local code=$?
    if (( __pb_running )); then
        __pb_osc "133;D;$code"
        __pb_running=0
    fi
    __pb_osc "7;file://${"$"}{HOST}$(__pb_urlencode "$PWD")"
    return $code
}

# last, so a theme that rewrites the prompt each time is marked too
__pb_mark_prompt() {
    local code=$?
    if [[ "$PS1" != *'133;A'* ]]; then PS1=$'%{\e]133;A\a%}'"$PS1"; fi
    return $code
}

__pb_preexec() {
    __pb_running=1
    __pb_osc "133;C;cmdline_url=$(__pb_urlencode "$1")"
}

autoload -Uz add-zsh-hook
precmd_functions=(__pb_precmd $precmd_functions)
add-zsh-hook precmd __pb_mark_prompt
add-zsh-hook preexec __pb_preexec
fi
`;

const FISH = `if status is-interactive; and not set -q __pb_loaded
    set -g __pb_loaded 1
    function __pb_osc
        printf '\\e]%s\\a' $argv[1]
    end
    function __pb_preexec --on-event fish_preexec
        __pb_osc "133;C;cmdline_url="(string escape --style=url -- $argv[1])
    end
    function __pb_postexec --on-event fish_postexec
        set -l code $status
        __pb_osc "133;D;$code"
    end
    function __pb_prompt --on-event fish_prompt
        __pb_osc "7;file://"(prompt_hostname)(string escape --style=url -- $PWD)
        __pb_osc "133;A"
    end
end`;

// Windows PowerShell 5.1 has no \`e, so the escapes are built from [char]
const POWERSHELL = String.raw`if (-not $Global:__pbLoaded) {
$Global:__pbLoaded = $true
$Global:__pbRunning = $false
$Global:__pbEsc = [string][char]27
$Global:__pbBel = [string][char]7
$Global:__pbPrompt = $function:prompt

function Global:prompt {
    $ok = $global:?
    $native = $global:LASTEXITCODE
    $marks = ""
    if ($Global:__pbRunning) {
        # a cmdlet that fails records an error; a program that fails only
        # sets its exit code
        $code = 0
        if (-not $ok) { if ($Error.Count -eq $Global:__pbErrors -and $native -is [int] -and $native -ne 0) { $code = $native } else { $code = 1 } }
        $marks += "$Global:__pbEsc]133;D;$code$Global:__pbBel"
        $Global:__pbRunning = $false
    }
    $here = $executionContext.SessionState.Path.CurrentLocation
    if ($here.Provider.Name -eq "FileSystem") {
        $parts = ($here.ProviderPath -replace '\\', '/').TrimStart('/') -split '/' | ForEach-Object { [System.Uri]::EscapeDataString($_) }
        $marks += "$Global:__pbEsc]7;file://$([Environment]::MachineName)/$($parts -join '/')$Global:__pbBel"
    }
    $marks += "$Global:__pbEsc]133;A$Global:__pbBel"
    $global:LASTEXITCODE = $native
    $marks + (& $Global:__pbPrompt)
}

if (Get-Command PSConsoleHostReadLine -ErrorAction SilentlyContinue) {
    $Global:__pbReadLine = $function:PSConsoleHostReadLine
    function Global:PSConsoleHostReadLine {
        $line = & $Global:__pbReadLine
        if ($line -and $line.Trim()) {
            $Global:__pbRunning = $true
            $Global:__pbErrors = $Error.Count
            [Console]::Write("$Global:__pbEsc]133;C;cmdline_url=$([System.Uri]::EscapeDataString($line))$Global:__pbBel")
        }
        $line
    }
}
}`;
