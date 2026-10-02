// Regression: a live supervisor on Windows is visible to the engine.
//
// Windows supervisors listen on a named pipe (`\\.\pipe\papercrane-…`),
// which fs.existsSync cannot stat even when the pipe is live. A presence
// check against the pipe path is therefore always false there, so an
// orphaned Ollama from a crashed app was never found: the next start
// spawned a second supervisor for the same pipe name, which fails to bind.
// On Windows the metadata file written beside the pipe is the presence fact;
// the connect remains the liveness probe.
import { describe, it, expect, beforeEach } from "bun:test";
import * as fs from "node:fs";
import {
    getSupervisorMetadataPath,
    getSupervisorSocketPath,
    supervisorPresent,
} from "../papercrane/supervisor";

const ID = "dev.paperboard.ai.ollama";

describe("supervisor endpoint presence", () => {
    beforeEach(() => {
        fs.rmSync(getSupervisorMetadataPath(ID), { force: true });
        fs.rmSync(getSupervisorSocketPath(ID), { force: true });
    });

    it("finds a live supervisor on Windows through its metadata file", () => {
        fs.writeFileSync(getSupervisorMetadataPath(ID), "{}");
        expect(supervisorPresent(ID, "win32")).toBe(true);
    });

    it("reports absence when neither the socket nor the metadata file exists", () => {
        expect(supervisorPresent(ID, "win32")).toBe(false);
        expect(supervisorPresent(ID, "linux")).toBe(false);
    });

    it("finds a live supervisor on POSIX through its socket file", () => {
        fs.writeFileSync(getSupervisorSocketPath(ID), "");
        expect(supervisorPresent(ID, "linux")).toBe(true);
    });
});
