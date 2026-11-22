import styles from "./viewers.module.css";
import { Failure } from "./Failure";
import { createMemo, For, Match, Switch } from "solid-js";
import { PaperLoader } from "../../../components/PaperLoader";
import { PaperTable } from "../../../components/PaperTable";
import { previewExtension } from "../kinds";
import { createTextRead } from "./read";
import { Cut } from "./TextView";

/** The most rows a table preview draws; the rest are counted, not drawn. */
export const PAPER_PREVIEW_TABLE_ROWS = 1000;

/**
 * Splits delimited text into rows the way spreadsheets read it (RFC 4180):
 * quoted fields may hold the delimiter, line breaks and doubled quotes.
 * Keeps the first `limit` rows and counts the ones after them.
 */
export function parseDelimited(text: string, delimiter: string, limit: number): { rows: string[][]; more: number } {
    const rows: string[][] = [];
    let more = 0;
    let row: string[] = [];
    let field = "";
    let quoted = false;
    // only a quote that opens a field starts a quoted one
    let fieldStart = true;
    // past the limit, fields are walked but not kept
    let keeping = limit > 0;
    const endRow = () => {
        if (keeping) {
            row.push(field);
            rows.push(row);
            keeping = rows.length < limit;
        } else more++;
        row = [];
        field = "";
        fieldStart = true;
    };
    // a byte-order mark is not part of the first header
    for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i++) {
        const c = text[i];
        if (quoted) {
            if (c !== '"') {
                if (keeping) field += c;
            } else if (text[i + 1] === '"') {
                if (keeping) field += '"';
                i++;
            } else quoted = false;
        } else if (c === '"' && fieldStart) {
            quoted = true;
            fieldStart = false;
        } else if (c === delimiter) {
            if (keeping) row.push(field);
            field = "";
            fieldStart = true;
        } else if (c === "\n" || c === "\r") {
            if (c === "\r" && text[i + 1] === "\n") i++;
            endRow();
        } else {
            if (keeping) field += c;
            fieldStart = false;
        }
    }
    // a last line without a line break still counts
    if (!fieldStart || row.length) endRow();
    return { rows, more };
}

/** The delimiter a CSV or TSV separates its cells with, told from its type, name and first line. */
export function sniffDelimiter(text: string, name: string, type = ""): string {
    if (type.toLowerCase().includes("tab-separated") || previewExtension(name) === "tsv") return "\t";
    // a CSV written where the comma is the decimal point uses semicolons
    const first = text.split(/\r?\n/, 1)[0] ?? "";
    return (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ";" : ",";
}

/** A CSV or TSV as a table with its first row as the header. */
export function TableView(props: { src: string; name: string; type?: string; onError: (message: string) => void }) {
    const read = createTextRead(
        () => props.src,
        (message) => props.onError(`${props.name} ${message}`),
    );
    const delimiter = () => sniffDelimiter(read.value()?.text ?? "", props.name, props.type);
    const table = createMemo(() => {
        const value = read.value();
        if (!value) return null;
        // the header plus the rows drawn
        // a file cut at the read cap ends mid-row: that row is left out, not shown broken
        const text = value.cut ? value.text.slice(0, Math.max(0, value.text.search(/[\r\n][^\r\n]*$/))) : value.text;
        const { rows, more } = parseDelimited(text, delimiter(), PAPER_PREVIEW_TABLE_ROWS + 1);
        const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
        const pad = (r: string[]) => (r.length < width ? [...r, ...Array<string>(width - r.length).fill("")] : r);
        return { head: pad(rows[0] ?? []), body: rows.slice(1).map(pad), more, cut: value.cut };
    });
    const note = () => {
        const t = table()!;
        if (!t.more && !t.cut) return "";
        const shown = t.body.length.toLocaleString();
        return t.cut ? `Showing the first ${shown} rows of a file too long to read whole.` : `Showing ${shown} of ${(t.body.length + t.more).toLocaleString()} rows.`;
    };
    return (
        <Switch>
            <Match when={read.error()}>
                <Failure title={`${props.name} ${read.error()}`} />
            </Match>
            <Match when={!table()}>
                <PaperLoader class={styles.centered} loaderStatus="indeterminate" delay={150} label={`Loading ${props.name}`} />
            </Match>
            <Match when={table()!.head.length === 0}>
                <Failure
                    icon="table_view"
                    title={table()!.cut ? `${props.name} has a first row too long to show` : `${props.name} is empty`}
                    alert={false}
                />
            </Match>
            <Match when={true}>
                <div class={styles.tableSheet}>
                    <div class={styles.tableScroll}>
                        <PaperTable class={styles.table}>
                            <thead>
                                <tr>
                                    <For each={table()!.head}>{(cell) => <th>{cell}</th>}</For>
                                </tr>
                            </thead>
                            <tbody>
                                <For each={table()!.body}>
                                    {(row) => (
                                        <tr>
                                            <For each={row}>{(cell) => <td>{cell}</td>}</For>
                                        </tr>
                                    )}
                                </For>
                            </tbody>
                        </PaperTable>
                    </div>
                    <Cut shown={!!note()} what="" rows={note()} />
                </div>
            </Match>
        </Switch>
    );
}
