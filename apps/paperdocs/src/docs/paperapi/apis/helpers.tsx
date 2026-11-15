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
                PaperAPI exports a few plain functions that every panel needs and none should write again: the words of a failure, a check for a JSON object, lines of tasks that run in order or a few at a time, and a file write that lands whole.
                All but the file write work on a panel page and in a service and import from <PaperCode>@mileniumhq/paperapi</PaperCode>. The file write is service-only.
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
    /** how many tasks are queued and not yet started */
    readonly waiting: number;
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
                <li><PaperCode>waiting</PaperCode> read inside a task is how many newer ones wait behind it. A save whose failure a newer save will carry on can tell so, and keep the change on screen instead of putting the saved value back.</li>
            </PaperTextList>
            <PaperCode block language="tsx">
{`import { SerialQueue } from "@mileniumhq/paperapi";

const lifecycle = new SerialQueue();
export const start = () => lifecycle.run(() => startServer());
export const stop = () => lifecycle.run(() => stopServer());`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="keyed-queue">KeyedQueue</PaperText>
            <PaperCode block language="tsx">
{`class KeyedQueue {
    /** queues task behind the others with key; resolves or rejects as it does */
    run<T>(key: string, task: () => T | Promise<T>): Promise<T>;
    /** how many keys have a task queued or running */
    readonly size: number;
}`}
            </PaperCode>
            <PaperText preset="body" as="p">
                A <PaperCode>SerialQueue</PaperCode> for each key, such as a file's path or a computer's id: tasks with one key run one at a time in order, and tasks with different keys run side by side.
                A key's line is forgotten once its last task settles, so keys that come and go don't pile up.
            </PaperText>
            <PaperCode block language="tsx">
{`import { KeyedQueue } from "@mileniumhq/paperapi";
import { writeFileAtomic } from "@mileniumhq/paperapi/fs";

const edits = new KeyedQueue();
// two quick edits of one file: the second reads what the first wrote
export const editFile = (file: string, change: (text: string) => string) =>
    edits.run(file, async () => writeFileAtomic(file, change(await fs.promises.readFile(file, "utf8"))));`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="limited-queue">LimitedQueue</PaperText>
            <PaperCode block language="tsx">
{`class LimitedQueue {
    constructor(limit: number);
    /** queues task; resolves or rejects as it does */
    run<T>(task: () => T | Promise<T>): Promise<T>;
    /** how many tasks are queued and not yet started */
    readonly waiting: number;
}`}
            </PaperCode>
            <PaperText preset="body" as="p">
                Tasks that run at most <PaperCode>limit</PaperCode> at a time, in the order they were queued, such as fetches a page of a hundred pictures asks for.
                One past the limit starts as soon as a running one settles, whichever way it ended. Each caller gets its own task's outcome, as with <PaperCode>SerialQueue</PaperCode>.
                A limit below 1 throws.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="write-file-atomic">writeFileAtomic</PaperText>
            <PaperCode block language="tsx">
{`import { isWriteFileAtomicTemp, writeFileAtomic, writeFileAtomicSync } from "@mileniumhq/paperapi/fs";

writeFileAtomic(file: string, data: string | Uint8Array, options?: WriteFileAtomicOptions): Promise<void>;
writeFileAtomicSync(file: string, data: string | Uint8Array, options?: WriteFileAtomicOptions): void;
isWriteFileAtomicTemp(name: string): boolean;

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
                <li>Two writes of one file at once both land whole, and the last rename wins. To keep them in order, run them through one <PaperCode>SerialQueue</PaperCode>, or a <PaperCode>KeyedQueue</PaperCode> keyed by the file.</li>
                <li><PaperCode>isWriteFileAtomicTemp</PaperCode> is whether a file name or path is one of its temp files: a write still landing, or one a crash left. A file list hides them. A sweep at startup, before anything writes, may delete them.</li>
            </PaperTextList>
        </PaperFlex>
    );
}
