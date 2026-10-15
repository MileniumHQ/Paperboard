import {
    PaperCode,
    PaperFlex,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";

export default function SystemApiDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">System API</PaperText>
            <PaperText preset="body">
                systemApi queries host operating system metrics and GPUs, triggers notifications, captures screenshots, and manages audio levels.
                Reach for systemApi when displaying device diagnostics, alerting users of background tasks, or reading host IP addresses.
                The API communicates directly with host daemon endpoints scoped to the active computer.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Import systemApi or system from @mileniumhq/paperapi.
                Query system details or trigger desktop alerts with straightforward async calls.
            </PaperText>
            <PaperCode block language="tsx">
{`import { systemApi } from "@mileniumhq/paperapi";

// Retrieve host system information
const info = await systemApi.getInfo();
console.log(info.hostname, info.os, info.arch);

// Dispatch a desktop notification
await systemApi.notify("Task completed", "Backup archive created successfully.");`}
            </PaperCode>

            <PaperText preset="subheader" id="methods-and-signatures">Methods and signatures</PaperText>
            <PaperText preset="body">
                The module provides the following system functions:
            </PaperText>

            <PaperTable>
                <thead>
                    <tr>
                        <th>Method</th>
                        <th>Signature</th>
                        <th>Description</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>getInfo</PaperCode></td>
                        <td><PaperCode>getInfo(): Promise&lt;SystemInfo&gt;</PaperCode></td>
                        <td>Returns host operating system details, hostname, distro, architecture, and username.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>getLocalIP</PaperCode></td>
                        <td><PaperCode>getLocalIP(): Promise&lt;string&gt;</PaperCode></td>
                        <td>Resolves the primary LAN IPv4 address of the host machine.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>getGpus</PaperCode></td>
                        <td><PaperCode>getGpus(): Promise&lt;GpuReport&gt;</PaperCode></td>
                        <td>Lists the host's GPUs with their memory, when the OS reports it. See <PaperCode>GPU inventory</PaperCode> below.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>getUsage</PaperCode></td>
                        <td><PaperCode>getUsage(computerId?): Promise&lt;UsageReport&gt;</PaperCode></td>
                        <td>Reports a computer's CPU and memory use, split by panel. See <PaperCode>Usage</PaperCode> below.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>notify</PaperCode></td>
                        <td><PaperCode>notify(title, message): Promise&lt;unknown&gt;</PaperCode></td>
                        <td>Dispatches a desktop notification through the host notification daemon.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>screenshot</PaperCode></td>
                        <td><PaperCode>screenshot(savePath): Promise&lt;string&gt;</PaperCode></td>
                        <td>Captures a screen image and writes it to the specified file path.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>setVolume</PaperCode></td>
                        <td><PaperCode>setVolume(volume): Promise&lt;number&gt;</PaperCode></td>
                        <td>Adjusts output audio volume (0 to 100).</td>
                    </tr>
                    <tr>
                        <td><PaperCode>setMuted</PaperCode></td>
                        <td><PaperCode>setMuted(muted): Promise&lt;boolean&gt;</PaperCode></td>
                        <td>Mutes or unmutes host audio output.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>beep</PaperCode></td>
                        <td><PaperCode>beep(): Promise&lt;unknown&gt;</PaperCode></td>
                        <td>Plays an alert bell tone through the host audio output.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" id="gpu-inventory">GPU inventory</PaperText>
            <PaperText preset="body">
                getGpus reads the GPUs of the computer the transport is scoped to. Each probe is read-only and has a five-second limit.
                When a probe fails, its message goes in errors and the list may be incomplete. An empty gpus array with no errors means the host has no GPU to report.
                Treat those two cases differently: "could not look" is not "nothing there".
            </PaperText>
            <PaperCode block language="tsx">
{`interface GpuReport {
    gpus: GpuInfo[];
    errors: string[]; // failed probes; non-empty means gpus may be incomplete
}

interface GpuInfo {
    name: string;                  // "Radeon RX 7700 XT / 7800 XT"
    vendor: "nvidia" | "amd" | "intel" | "apple" | "other";
    memoryTotalBytes?: number;     // absent when the OS does not say
    memoryFreeBytes?: number;
    unifiedMemory?: boolean;       // true on Apple Silicon: memory is system RAM
    driver?: string;
    source: string;                // "nvidia-smi" | "sysfs" | "system_profiler" | "registry"
}`}
            </PaperCode>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Host</th>
                        <th>Source</th>
                        <th>Memory</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>Linux</td>
                        <td><PaperCode>nvidia-smi</PaperCode> for NVIDIA, then <PaperCode>/sys/class/drm</PaperCode> for everything else. Names come from <PaperCode>pci.ids</PaperCode>.</td>
                        <td>Total and free for NVIDIA and AMD (amdgpu). Intel integrated graphics report none.</td>
                    </tr>
                    <tr>
                        <td>macOS</td>
                        <td><PaperCode>system_profiler SPDisplaysDataType</PaperCode></td>
                        <td>Apple Silicon reports system RAM with unifiedMemory. Discrete GPUs report their VRAM.</td>
                    </tr>
                    <tr>
                        <td>Windows</td>
                        <td><PaperCode>nvidia-smi</PaperCode> for NVIDIA, then the display adapter registry class</td>
                        <td>Total from the 64-bit <PaperCode>HardwareInformation.qwMemorySize</PaperCode>, which has no 4 GiB cap. Free memory comes only from nvidia-smi.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperCode block language="tsx">
{`const { gpus, errors } = await systemApi.getGpus();
const best = gpus
    .filter((gpu) => gpu.memoryTotalBytes)
    .sort((a, b) => b.memoryTotalBytes! - a.memoryTotalBytes!)[0];

if (best) {
    console.log(\`\${best.name}: \${(best.memoryTotalBytes! / 2 ** 30).toFixed(1)} GiB\`);
} else if (errors.length > 0) {
    console.warn("GPU inventory unavailable:", errors);
} else {
    console.log("No GPU reported; models will run on the CPU");
}`}
            </PaperCode>

            <PaperText preset="subheader" id="usage">Usage</PaperText>
            <PaperText preset="body">
                getUsage reports how a computer's CPU and memory are being used, and by whom: Paperboard itself, each panel, and everything else.
                It also reports the disk holding Paperboard's data, network traffic, and uptime.
                It is for the Paperboard app. A panel's scoped token is refused.
                CPU is measured between two readings, so cpu is null, and each group's cpuPercent is null, until an interval has been measured.
            </PaperText>
            <PaperCode block language="tsx">
{`interface UsageReport {
    sampledAt: number;
    memory: { totalBytes: number; availableBytes: number; otherBytes: number };
    cpu: { cores: number; idlePercent: number; otherPercent: number } | null;
    groups: UsageGroup[];
    disk?: { totalBytes: number; freeBytes: number } | null;
    network?: { receivePerSecond: number; sendPerSecond: number } | null;
    uptimeSeconds?: number;
}

interface UsageGroup {
    id: string;
    kind: "paperboard" | "panel";
    memoryBytes: number;
    cpuPercent: number | null;
}`}
            </PaperCode>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Field</th>
                        <th>Description</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>memory.otherBytes</PaperCode></td>
                        <td>Memory in use by everything that is not Paperboard or a panel.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>cpu.idlePercent</PaperCode>, <PaperCode>cpu.otherPercent</PaperCode></td>
                        <td>Shares of the whole computer, every core together, from 0 to 100.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>disk</PaperCode></td>
                        <td>The drive holding Paperboard's data. null when the computer can't read it.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>network</PaperCode></td>
                        <td>Bytes per second received and sent over the physical network adapters, measured between two readings. null until an interval has been measured, after a counter reset, or when the computer can't read it.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>uptimeSeconds</PaperCode></td>
                        <td>How long the computer has been running.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>groups[].id</PaperCode></td>
                        <td>paperboard, or a panel id.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>groups[].cpuPercent</PaperCode></td>
                        <td>Share of the whole computer from 0 to 100, or null until measured.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                System operations run against the computer to which the active transport session is scoped.
                Notification requests fall back gracefully if notification daemons are unavailable on headless hosts.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Read host network IP to configure remote game servers or local web listeners.
            </PaperText>
            <PaperCode block language="tsx">
{`const localIp = await systemApi.getLocalIP();
console.log(\`Connect client to http://\${localIp}:8080\`);`}
            </PaperCode>
        </PaperFlex>
    );
}
