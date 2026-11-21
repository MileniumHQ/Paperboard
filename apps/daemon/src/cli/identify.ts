// `papercrane identify`: the identity this daemon reports, read here and now
import { EXIT } from "./cli";
import { getDetailedOsInfo } from "../system/osInfo";
import type { IdentityPart } from "../system/identity";

const named = (part: IdentityPart) => (part.version ? `${part.name} ${part.version}` : part.name);

export async function runIdentify(json: boolean): Promise<number> {
    const id = await getDetailedOsInfo();
    if (json) {
        console.log(JSON.stringify({ ...id, arch: process.arch }, null, 2));
        return EXIT.OK;
    }
    const rows: [string, string | undefined][] = [
        ["Operated by", id.operator && named(id.operator)],
        ["System", id.flavor && named(id.flavor)],
        ["OS", `${id.distroName ?? id.os} (${[id.distroId ?? id.os, id.osVersion].filter(Boolean).join(" ")})`],
        ["Runs in", id.machine && named(id.machine)],
        ["Board", id.board],
        ["Arch", process.arch],
    ];
    for (const [label, value] of rows) if (value) console.log(`${label.padEnd(12)} ${value}`);
    return EXIT.OK;
}
