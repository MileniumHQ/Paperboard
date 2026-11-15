// Another panel on the test daemon (test/helpers/crane.ts starts it), as its
// own process with its own panel token, doing what its role names:
//
//   fixture  "Fixture Panel" offering blocks: Greet, Count Players, Someone
//            Joined, and Next Line, a text value that reads the lines the
//            test queued, one per read ({ do: "lines", lines })
//   late     "Late Panel" offering Wave
//   window   another Blocks window: it makes the service's calls
//            ({ do: "call", name, input }) and reads its state ({ do: "state" })
//
// It says it is ready once its blocks are registered, and answers each
// request the test sends over IPC.
import { blocksApi, errorMessage, serviceClient, type BlockSet } from "@mileniumhq/paperapi";
import { blocksContract } from "../../src/panel";

const role = process.argv[2];
const panelId = process.env.PAPERBOARD_PANEL_ID!;
const lines: string[] = [];

const SETS: Record<string, BlockSet> = {
    fixture: {
        commands: [
            { id: "greet", name: "Greet", text: "Greet {who}", inputs: { who: { type: "text", name: "Who" } }, run: () => undefined },
            { id: "count", name: "Count Players", text: "Count players", output: "number", outputName: "Players", run: () => 0 },
        ],
        values: [
            {
                id: "next-line",
                name: "Next Line",
                type: "text",
                read: () => {
                    const line = lines.shift();
                    if (line === undefined) throw new Error("the test queued no line to read");
                    return line;
                },
            },
        ],
        events: [{ id: "joined", name: "Someone Joined", values: { who: { type: "text", name: "Who" } } }],
    },
    late: { commands: [{ id: "wave", name: "Wave", text: "Wave", run: () => undefined }] },
};

const window = role === "window" ? serviceClient(blocksContract) : null;

async function answer(request: Record<string, any>): Promise<unknown> {
    if (request.do === "lines" && role === "fixture") return void lines.push(...request.lines);
    if (request.do === "register" && SETS[role ?? ""]) return blocksApi.panel(panelId).register(SETS[role!]!);
    if (request.do === "call" && window) return (window.calls as Record<string, (input: unknown) => Promise<unknown>>)[request.name]!(request.input);
    if (request.do === "state" && window) return window.state.refresh();
    if (request.do === "list") return blocksApi.list();
    throw new Error(`the ${role} panel does not do ${JSON.stringify(request)}`);
}

process.on("message", (message: any) => {
    if (message?.type !== "ask") return;
    answer(message.request).then(
        (result) => process.send!({ type: "answer", id: message.id, result: result ?? null }),
        (err: unknown) => process.send!({ type: "answer", id: message.id, error: errorMessage(err) }),
    );
});

const set = SETS[role ?? ""];
if (set) await blocksApi.panel(panelId).register(set);
else if (window) await window.state.refresh();
else throw new Error(`no such role: ${role}`);
process.send!({ type: "paperboard:service-ready", panelId });
