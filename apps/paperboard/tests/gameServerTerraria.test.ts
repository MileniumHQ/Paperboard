import { test } from "bun:test";
import { runTerrariaScenario } from "./fixtures/gameServerTerraria";
test("Terraria through daemon: actual stdin/listener, vault, relocated port, offline/scheduled backup, restore and startup deadline", () => runTerrariaScenario(false), 120_000);
