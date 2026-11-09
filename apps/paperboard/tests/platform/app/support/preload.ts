// bun test preload (bunfig.toml): takes down what the desktop-app suite
// made once every test file has run. bun test runs no process "exit"
// handlers, so this is the one place that sees the end of the run.
import { afterAll } from "bun:test";
import { cleanupSuite } from "./temp";

afterAll(() => cleanupSuite());
