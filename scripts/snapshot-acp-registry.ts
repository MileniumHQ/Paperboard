#!/usr/bin/env bun
/**
 * snapshot-acp-registry.ts — Captures the ACP agent registry for the AI panel
 *
 * Usage: bun scripts/snapshot-acp-registry.ts
 * Output: panels/dev.paperboard.ai/src/data/acp-agents.json
 *
 * The panel never downloads agent code: it runs agents the user installed
 * themselves. So the snapshot records, per agent, the command an install
 * puts on PATH (an npm package's bin, or a release binary's file name) and
 * how to install it. Agents without a stable command name are left out.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";

const REGISTRY_URL = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";
const NPM_URL = "https://registry.npmjs.org";
const OUT_FILE = join(import.meta.dir, "..", "panels", "dev.paperboard.ai", "src", "data", "acp-agents.json");
const MAX_AGENTS = 200;

interface RegistryAgent {
    id: string;
    name: string;
    description?: string;
    website?: string;
    repository?: string;
    distribution: {
        npx?: { package: string; args?: string[] };
        binary?: Record<string, { cmd?: string; args?: string[] }>;
        uvx?: { package: string; args?: string[] };
    };
}

export interface SnapshotAgent {
    id: string;
    name: string;
    description: string;
    website?: string;
    /** the executable an install puts on PATH */
    command: string;
    args: string[];
    install: { kind: "npm"; package: string } | { kind: "download"; url: string };
}

/** "@scope/pkg@1.2.3" → "@scope/pkg" */
export function packageName(spec: string): string {
    const at = spec.lastIndexOf("@");
    return at > 0 ? spec.slice(0, at) : spec;
}

/** The bin an npm install links: the one named like the package, else the first. */
export function npmCommand(pkg: string, bin: Record<string, string> | string | undefined): string | undefined {
    const unscoped = pkg.split("/").pop()!;
    if (typeof bin === "string") return unscoped;
    const names = Object.keys(bin ?? {});
    return names.includes(unscoped) ? unscoped : names[0];
}

/** A release binary's command, when every platform ships the same plain file name. */
export function binaryCommand(binary: RegistryAgent["distribution"]["binary"]): { command: string; args: string[] } | undefined {
    const entries = Object.values(binary ?? {});
    if (entries.length === 0) return undefined;
    const names = new Set(entries.map((e) => (e.cmd ?? "").split(/[\\/]/).pop()!.replace(/\.exe$/i, "")));
    const [command] = names;
    if (names.size !== 1 || !command || !/^[a-z][a-z0-9-]*$/.test(command)) return undefined;
    return { command, args: entries[0]!.args ?? [] };
}

export function snapshotAgent(agent: RegistryAgent, bins: Map<string, Record<string, string> | string | undefined>): SnapshotAgent | undefined {
    const base = {
        id: agent.id,
        name: agent.name,
        description: agent.description ?? "",
        ...(agent.website ? { website: agent.website } : {}),
    };
    const npx = agent.distribution.npx;
    if (npx) {
        const pkg = packageName(npx.package);
        const command = npmCommand(pkg, bins.get(npx.package));
        if (command) return { ...base, command, args: npx.args ?? [], install: { kind: "npm", package: pkg } };
    }
    const binary = binaryCommand(agent.distribution.binary);
    const page = agent.website ?? agent.repository;
    if (binary && page) return { ...base, ...binary, install: { kind: "download", url: page } };
    return undefined;
}

async function json(url: string): Promise<any> {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return res.json();
}

if (import.meta.main) {
    const registry = await json(REGISTRY_URL);
    const agents: RegistryAgent[] = registry.agents.slice(0, MAX_AGENTS);
    const bins = new Map<string, Record<string, string> | string | undefined>();
    for (const agent of agents) {
        const spec = agent.distribution.npx?.package;
        if (!spec) continue;
        const pkg = packageName(spec);
        const version = spec.slice(pkg.length + 1) || "latest";
        bins.set(spec, (await json(`${NPM_URL}/${pkg.replace("/", "%2F")}/${version}`)).bin);
    }
    const kept = agents.map((a) => snapshotAgent(a, bins)).filter((a): a is SnapshotAgent => Boolean(a));
    const skipped = agents.filter((a) => !kept.some((k) => k.id === a.id)).map((a) => a.id);
    const out = {
        schemaVersion: 1,
        source: REGISTRY_URL,
        capturedAt: new Date().toISOString().slice(0, 10),
        agents: kept,
    };
    writeFileSync(OUT_FILE, `${JSON.stringify(out, null, 2)}\n`);
    console.log(`${kept.length} agents written to ${OUT_FILE}; skipped (no stable command): ${skipped.join(", ") || "none"}`);
}
