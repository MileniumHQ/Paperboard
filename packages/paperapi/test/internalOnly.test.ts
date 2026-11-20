// What is Paperboard's own stays out of a panel's reach: the registry merge,
// the store listing and the paint wait come from "@mileniumhq/paperapi/internal",
// not from the index a panel imports.
import { expect, test } from "bun:test";
import * as panelFacing from "../src/index";
import * as internalLists from "../src/internal";
import * as paint from "../src/paintReady";

const internal = { ...internalLists, ...paint };

test("the panel-facing index has none of the internal subpath's exports", () => {
    const leaked = Object.keys(internal).filter((name) => Object.hasOwn(panelFacing, name));
    expect(leaked).toEqual([]);
    expect(Object.keys(internal)).toContain("mergeRegistryWithInstalled");
    expect(Object.keys(internal)).toContain("loadInstalledPanelMedia");
    expect(Object.keys(internal)).toContain("waitForContentPainted");
});
