import {
    PaperCode,
    PaperFlex,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function HelpersDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">Helpers</PaperText>
            <PaperText preset="body" as="p">
                PaperAPI exports a few plain functions that every panel needs and none should write again: the words of a failure, a check for a JSON object, a line of tasks that run in order, and a file write that lands whole.
                The first three work on a panel page and in a service and import from <PaperCode>@mileniumhq/paperapi</PaperCode>. The file write is service-only.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="error-message">errorMessage and errorCode</PaperText>
            <PaperCode block language="tsx">
{`errorMessage(err: unknown): string;
errorCode(err: unknown): string | undefined;`}
            </PaperCode>
            <PaperText preset="body" as="p">
                <PaperCode>errorMessage</PaperCode> is what a caught failure says, for the person to read: an Error's own message, and anything else thrown turned into text.
                Show it as it is, never a generic "something went wrong".
                <PaperCode>errorCode</PaperCode> is the system's code for a failure, such as <PaperCode>ENOENT</PaperCode> or <PaperCode>EACCES</PaperCode>, when the error carries one as text, and <PaperCode>undefined</PaperCode> otherwise.
            </PaperText>
            <PaperCode block language="tsx">
{`import { errorCode, errorMessage } from "@mileniumhq/paperapi";

try {
    await fs.promises.readFile(file, "utf8");
} catch (err) {
    if (errorCode(err) === "ENOENT") return defaults;
    throw new Error(\`The settings couldn't be read: \${errorMessage(err)}\`);
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="is-record">isRecord</PaperText>
            <PaperCode block language="tsx">
{`isRecord(value: unknown): value is Record<string, unknown>;`}
            </PaperCode>
            <PaperText preset="body" as="p">
                Whether a value is a plain object, such as one <PaperCode>JSON.parse</PaperCode> made: not <PaperCode>null</PaperCode>, not an array, and not an instance of a class such as a Date or a Map.
                Use it to read a saved file or a call's arguments field by field, checking each field before using it.
            </PaperText>
            <PaperCode block language="tsx">
{`import { isRecord } from "@mileniumhq/paperapi";

const raw: unknown = JSON.parse(text);
if (!isRecord(raw) || typeof raw.name !== "string") throw new Error("The saved world has no name");`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="serial-queue">SerialQueue</PaperText>
            <PaperCode block language="tsx">
{`class SerialQueue {
    /** queues task; resolves or rejects as it does */
    run<T>(task: () => T | Promise<T>): Promise<T>;
    /** resolves once every task queued so far has settled */
    settled(): Promise<void>;
}`}
            </PaperCode>
            <PaperText preset="body" as="p">
                Tasks that must not overlap, such as two writes of one file or a stop and a start of one server, go through one queue.
            </PaperText>
            <PaperTextList>
                <li>Each task starts once the one before it has settled, whichever way it ended, in the order <PaperCode>run</PaperCode> was called.</li>
                <li>Each caller gets its own task's outcome. A task that fails rejects only its own promise, and the tasks behind it still run.</li>
                <li><PaperCode>run</PaperCode> is bound, so it can be passed on, such as to PaperUI's <PaperCode>createSavedValue</PaperCode> as its <PaperCode>queue</PaperCode>.</li>
            </PaperTextList>
            <PaperCode block language="tsx">
{`import { SerialQueue } from "@mileniumhq/paperapi";

const lifecycle = new SerialQueue();
export const start = () => lifecycle.run(() => startServer());
export const stop = () => lifecycle.run(() => stopServer());`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="write-file-atomic">writeFileAtomic</PaperText>
            <PaperCode block language="tsx">
{`import { writeFileAtomic, writeFileAtomicSync } from "@mileniumhq/paperapi/fs";

writeFileAtomic(file: string, data: string | Uint8Array, options?: WriteFileAtomicOptions): Promise<void>;
writeFileAtomicSync(file: string, data: string | Uint8Array, options?: WriteFileAtomicOptions): void;

interface WriteFileAtomicOptions {
    /** the written file's permissions, set exactly; default 0o666 less the umask */
    mode?: number;
}`}
            </PaperCode>
            <PaperText preset="body" as="p">
                Replaces a file whole or not at all, for every file a service rewrites.
                It runs in a service only, so it has its own import path, <PaperCode>@mileniumhq/paperapi/fs</PaperCode>.
            </PaperText>
            <PaperTextList>
                <li>The data goes to a temp file beside the file, with a name no other writer shares, is flushed to disk, and is renamed over the file. A crash leaves the old file, never half of the new one.</li>
                <li>The file's folder is made when it is missing.</li>
                <li><PaperCode>mode</PaperCode> is set from the moment the temp file exists, so a secret written with <PaperCode>0o600</PaperCode> is never readable by others. Pass an old file's <PaperCode>stat().mode</PaperCode> to keep a script executable.</li>
                <li>A write that fails throws its own error and removes its temp file. If that removal fails too, it is logged, and the write's error is still what is thrown.</li>
                <li>Two writes of one file at once both land whole, and the last rename wins. To keep them in order, run them through one <PaperCode>SerialQueue</PaperCode>.</li>
            </PaperTextList>
        </PaperFlex>
    );
}
