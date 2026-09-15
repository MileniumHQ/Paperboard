// ─── Browser Data Converter (CSV ↔ JSON) ───────────────────────────────────

export function csvToJson(csvText: string): string {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length === 0) return "[]";

  const headers = parseCsvLine(lines[0]);
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = parseCsvLine(lines[i]);
    const obj: Record<string, string | number | boolean> = {};
    for (let j = 0; j < headers.length; j++) {
      const val = values[j] ?? "";
      // Auto-cast numbers/booleans if clean
      if (val === "true") obj[headers[j]] = true;
      else if (val === "false") obj[headers[j]] = false;
      else if (!isNaN(Number(val)) && val.trim() !== "") obj[headers[j]] = Number(val);
      else obj[headers[j]] = val;
    }
    rows.push(obj);
  }

  return JSON.stringify(rows, null, 2);
}

export function jsonToCsv(jsonText: string): string {
  const parsed = JSON.parse(jsonText);
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  if (arr.length === 0) return "";

  const headers = Array.from(
    new Set(arr.flatMap((item) => (typeof item === "object" && item ? Object.keys(item) : []))),
  );

  const csvRows: string[] = [];
  csvRows.push(headers.map(escapeCsv).join(","));

  for (const item of arr) {
    const row = headers.map((h) => escapeCsv(item?.[h] !== undefined ? String(item[h]) : ""));
    csvRows.push(row.join(","));
  }

  return csvRows.join("\n");
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function escapeCsv(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

export async function convertData(
  file: File,
  target: string,
): Promise<{ blob: Blob }> {
  const text = await file.text();
  if (target === "json") {
    const json = csvToJson(text);
    return { blob: new Blob([json], { type: "application/json" }) };
  } else if (target === "csv") {
    const csv = jsonToCsv(text);
    return { blob: new Blob([csv], { type: "text/csv" }) };
  }
  throw new Error(`Unsupported data target format: ${target}`);
}
