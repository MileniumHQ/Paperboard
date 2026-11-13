import {
    PaperCode,
    PaperFlex,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function SystemApiDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">systemApi</PaperText>
            <PaperText preset="body" as="p">
                systemApi describes the computer the panel runs on: its system, its address on the network, and its graphics cards.
                It works on a panel page, in a widget and in a service, and answers for the computer the daemon runs on, not the one showing the page.
                Use it to pick the right download, show where a server can be reached, or check a GPU before starting a model.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperCode block language="tsx">
{`import { systemApi } from "@mileniumhq/paperapi";

const info = await systemApi.getInfo();
const address = \`\${info.ip}:25565\`;

const report = await systemApi.getGpus();
const vram = Math.max(0, ...report.gpus.map((gpu) => gpu.memoryTotalBytes ?? 0));
if (report.errors.length > 0) {
    setNotice(\`The GPU list may be incomplete: \${report.errors.join("; ")}\`);
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="api">API</PaperText>
            <PaperCode block language="tsx">
{`systemApi.getInfo(): Promise<SystemInfo>;
systemApi.getLocalIP(): Promise<string>;
systemApi.getGpus(): Promise<GpuReport>;
/** Paperboard only */
systemApi.getUsage(computerId?: string): Promise<UsageReport>;

interface SystemInfo {
    /** "papercrane" */
    service: string;
    /** the daemon's version */
    version: string;
    hostname: string;
    /** "linux", "macos" or "windows" */
    os: string;
    osVersion?: string;
    /** Linux: the distribution, such as "arch" and "Arch Linux" */
    distroId?: string;
    distroName?: string;
    /** "x64" or "arm64" */
    arch: string;
    /** the same address getLocalIP returns */
    ip: string;
    /** the account the daemon runs as */
    username?: string;
}

interface GpuReport {
    gpus: GpuInfo[];
    /** probes that failed; when not empty, gpus may be incomplete */
    errors: string[];
}

interface GpuInfo {
    name: string;
    vendor: "nvidia" | "amd" | "intel" | "apple" | "other";
    /** dedicated memory, or system memory when unifiedMemory is true */
    memoryTotalBytes?: number;
    memoryFreeBytes?: number;
    /** the GPU shares system memory, as on Apple silicon */
    unifiedMemory?: boolean;
    driver?: string;
    /** where the facts came from: "nvidia-smi", "sysfs", "system_profiler" or "registry" */
    source: string;
}`}
            </PaperCode>
            <PaperText preset="body" as="p">
                An example <PaperCode>getInfo</PaperCode> answer:
            </PaperText>
            <PaperCode block language="json">
{`{
    "service": "papercrane",
    "version": "0.4.0",
    "hostname": "workstation",
    "os": "linux",
    "osVersion": "rolling",
    "distroId": "arch",
    "distroName": "Arch Linux",
    "arch": "x64",
    "ip": "192.168.1.20",
    "username": "alex"
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperTextList>
                <li><PaperCode>getLocalIP</PaperCode> returns the computer's first private IPv4 address, such as <PaperCode>192.168.1.20</PaperCode>. Without one, it returns the first other external IPv4 address, and without that, <PaperCode>127.0.0.1</PaperCode>.</li>
                <li>Other devices on the same network reach the computer at that address. Devices outside it need the router's public address and a forwarded port.</li>
                <li><PaperCode>getGpus</PaperCode> asks the system each time. A probe that fails, such as a missing <PaperCode>nvidia-smi</PaperCode>, adds to <PaperCode>errors</PaperCode> instead of failing the call.</li>
                <li><PaperCode>getUsage</PaperCode> reports CPU, memory, disk and network use split by panel, for Paperboard's computer page. A panel's call is refused with <PaperCode>system:usage is host-only</PaperCode> (<PaperCode>FORBIDDEN</PaperCode>).</li>
            </PaperTextList>

        </PaperFlex>
    );
}
