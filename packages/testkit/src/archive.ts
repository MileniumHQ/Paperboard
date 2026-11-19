// Archives built byte by byte: a raw ustar writer, so a test can put on the
// wire exactly the member a hostile archive would (a "../" name, a symlink
// that escapes, a hardlink, a device), and zips with Unix modes.
import * as zlib from "node:zlib";
import AdmZip from "adm-zip";

export type TarMember =
	| { name: string; type?: "file"; content?: string | Buffer; mode?: number }
	| { name: string; type: "dir"; mode?: number }
	| { name: string; type: "symlink" | "hardlink"; target: string }
	| { name: string; type: "fifo" | "chardev" };

const TYPE_FLAG = { file: "0", hardlink: "1", symlink: "2", chardev: "3", dir: "5", fifo: "6" } as const;

function octal(value: number, width: number): string {
	return `${value.toString(8).padStart(width - 1, "0")}\0`;
}

function header(member: TarMember, size: number): Buffer {
	const block = Buffer.alloc(512, 0);
	let name = member.name;
	if (Buffer.byteLength(name) > 100) {
		// the real name travels in the pax header before this one
		name = name.slice(0, 99);
	}
	const type = member.type ?? "file";
	const mode = "mode" in member && member.mode !== undefined ? member.mode : type === "dir" ? 0o755 : 0o644;
	block.write(name, 0, 100, "utf8");
	block.write(octal(mode, 8), 100, 8, "ascii");
	block.write(octal(0, 8), 108, 8, "ascii");
	block.write(octal(0, 8), 116, 8, "ascii");
	block.write(octal(size, 12), 124, 12, "ascii");
	block.write(octal(1_700_000_000, 12), 136, 12, "ascii");
	block.fill(0x20, 148, 156);
	block.write(TYPE_FLAG[type], 156, 1, "ascii");
	if (type === "symlink" || type === "hardlink") block.write((member as { target: string }).target, 157, 100, "utf8");
	block.write("ustar\0", 257, 6, "ascii");
	block.write("00", 263, 2, "ascii");
	let sum = 0;
	for (const byte of block) sum += byte;
	block.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
	return block;
}

function pad512(length: number): Buffer {
	return Buffer.alloc((512 - (length % 512)) % 512, 0);
}

// a pax extended header carrying a path too long for ustar
function paxPath(name: string): Buffer[] {
	const field = (n: number) => `${n} path=${name}\n`;
	let length = Buffer.byteLength(field(0));
	while (Buffer.byteLength(field(length)) !== length) length = Buffer.byteLength(field(length));
	const body = Buffer.from(field(length));
	const block = header({ name: "PaxHeader", type: "file" }, body.length);
	block.write("x", 156, 1, "ascii");
	let sum = 0;
	block.fill(0x20, 148, 156);
	for (const byte of block) sum += byte;
	block.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
	return [block, body, pad512(body.length)];
}

export function tar(members: TarMember[]): Buffer {
	const parts: Buffer[] = [];
	for (const member of members) {
		if (Buffer.byteLength(member.name) > 100) parts.push(...paxPath(member.name));
		const content = (member.type ?? "file") === "file" ? Buffer.from((member as { content?: string | Buffer }).content ?? "") : Buffer.alloc(0);
		parts.push(header(member, content.length), content);
		const pad = (512 - (content.length % 512)) % 512;
		if (pad) parts.push(Buffer.alloc(pad, 0));
	}
	parts.push(Buffer.alloc(1024, 0));
	return Buffer.concat(parts);
}

export function tarGz(members: TarMember[]): Buffer {
	return zlib.gzipSync(tar(members));
}

// A zip whose entries carry Unix modes (as made on macOS or Linux).
export function zip(entries: Array<{ name: string; content: string | Buffer; mode?: number }>): Buffer {
	const archive = new AdmZip();
	for (const entry of entries) {
		archive.addFile(entry.name, Buffer.from(entry.content));
		if (entry.mode !== undefined) {
			const added = archive.getEntry(entry.name)!;
			added.attr = ((0o100000 | entry.mode) << 16) >>> 0;
			added.header.made = 0x0314;
		}
	}
	return archive.toBuffer();
}
