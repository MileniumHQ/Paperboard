import { describe, expect, test } from "bun:test";
import { ShellMarks, type ShellCommand } from "../../papercrane/shellIntegration";

const ESC = "\u001b";
const BEL = "\u0007";
const osc = (body: string, end = BEL) => `${ESC}]${body}${end}`;

function reader(platform: NodeJS.Platform = "linux") {
	const commands: ShellCommand[] = [];
	const folders: string[] = [];
	const marks = new ShellMarks({ command: (c) => commands.push(c), cwd: (c) => folders.push(c) }, platform);
	return { marks, commands, folders };
}

// a panel follows a terminal's commands from these: each must be reported
// once, with its command line and exit code, however the output is cut up
describe("a shell's marks become commands and folders", () => {
	test("a command is reported once at its end, with what was typed and how it ended", () => {
		const { marks, commands, folders } = reader();
		marks.feed(osc("7;file://box/home/me%20too") + osc("133;A") + "$ ");
		marks.feed(osc("133;C;cmdline_url=npm%20run%20build") + "building\r\n" + osc("133;D;2"));
		expect(commands).toEqual([{ command: "npm run build", exitCode: 2 }]);
		expect(folders).toEqual(["/home/me too"]);
	});

	test("a sequence cut between two pieces of output is read whole, with either terminator", () => {
		const { marks, commands } = reader();
		const whole = osc("133;C;cmdline_url=ls", `${ESC}\\`) + "a b\r\n" + osc("133;D;0", `${ESC}\\`);
		for (const piece of whole.split("")) marks.feed(piece);
		expect(commands).toEqual([{ command: "ls", exitCode: 0 }]);
	});

	test("marks said twice (a shell that marks itself, and the script) report one command", () => {
		const { marks, commands } = reader();
		marks.feed(osc("133;C;cmdline_url=make") + osc("133;C") + "ok\r\n" + osc("133;D;0") + osc("133;D;0"));
		expect(commands).toEqual([{ command: "make", exitCode: 0 }]);
	});

	test("an end with no command (an empty line) reports nothing", () => {
		const { marks, commands } = reader();
		marks.feed(osc("133;A") + osc("133;D;0") + osc("133;A"));
		expect(commands).toEqual([]);
	});

	test("a replay sets the folder but does not report its commands again", () => {
		const { marks, commands, folders } = reader();
		marks.replay(osc("133;C;cmdline_url=ls") + osc("133;D;0") + osc("7;file://box/srv"));
		expect(commands).toEqual([]);
		expect(folders).toEqual(["/srv"]);
		marks.feed(osc("133;C;cmdline_url=pwd") + osc("133;D;0"));
		expect(commands).toEqual([{ command: "pwd", exitCode: 0 }]);
	});

	test("a Windows folder arrives as a Windows path", () => {
		const { marks, folders } = reader("win32");
		marks.feed(osc("7;file://PC/C%3A%2FUsers%2Fme"));
		marks.feed(osc("7;file://PC/D:/"));
		expect(folders).toEqual(["C:\\Users\\me", "D:\\"]);
	});
});
