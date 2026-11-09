// A tool server: MCP over stdio, one JSON-RPC message a line. Its one tool,
// whoami, answers with the MY_TOKEN it was started with.
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => {
    buf += d;
    for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
        const msg = JSON.parse(buf.slice(0, i));
        buf = buf.slice(i + 1);
        if (msg.id === undefined) continue;
        const reply = (result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }) + "\n");
        if (msg.method === "initialize") reply({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "whoami" } });
        else if (msg.method === "tools/list") reply({ tools: [{ name: "whoami", description: "who am I", inputSchema: { type: "object" } }] });
        else if (msg.method === "tools/call") reply({ content: [{ type: "text", text: `token=${process.env.MY_TOKEN}` }] });
        else process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "no" } }) + "\n");
    }
});
process.stdin.on("end", () => process.exit(0));
