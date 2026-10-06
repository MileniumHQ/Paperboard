// ─── Browser Spreadsheet & Workbook Converter ───────────────────────────────
// Powered by SheetJS (xlsx): bi-directional conversion between XLSX, XLS, CSV, JSON, and HTML tables.

import * as XLSX from "xlsx";

export async function convertSpreadsheet(
  file: File,
  target: string,
): Promise<{ blob: Blob; mime: string }> {
  const ext = file.name.split(".").pop()?.toLowerCase();
  const targetExt = target.toLowerCase();

  let workbook: XLSX.WorkBook;

  if (ext === "csv") {
    const text = await file.text();
    workbook = XLSX.read(text, { type: "string" });
  } else if (ext === "json") {
    const jsonText = await file.text();
    const data = JSON.parse(jsonText);
    const rows = Array.isArray(data) ? data : [data];
    const sheet = XLSX.utils.json_to_sheet(rows);
    workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
  } else {
    // Binary XLSX or XLS
    const arrayBuffer = await file.arrayBuffer();
    workbook = XLSX.read(arrayBuffer, { type: "array" });
  }

  const firstSheetName = workbook.SheetNames[0];
  const firstSheet = workbook.Sheets[firstSheetName];

  if (targetExt === "csv") {
    const csv = XLSX.utils.sheet_to_csv(firstSheet);
    return {
      blob: new Blob([csv], { type: "text/csv;charset=utf-8" }),
      mime: "text/csv",
    };
  }

  if (targetExt === "json") {
    const json = XLSX.utils.sheet_to_json(firstSheet);
    const formatted = JSON.stringify(json, null, 2);
    return {
      blob: new Blob([formatted], { type: "application/json" }),
      mime: "application/json",
    };
  }

  if (targetExt === "html") {
    const htmlTable = XLSX.utils.sheet_to_html(firstSheet);
    const pageHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${file.name}</title><style>table{border-collapse:collapse;width:100%;font-family:sans-serif;}td,th{border:1px solid #ccc;padding:8px;text-align:left;}tr:nth-child(even){background:#f9f9f9;}</style></head><body>${htmlTable}</body></html>`;
    return {
      blob: new Blob([pageHtml], { type: "text/html;charset=utf-8" }),
      mime: "text/html",
    };
  }

  if (targetExt === "xlsx") {
    const outBuffer = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
    return {
      blob: new Blob([outBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
  }

  throw new Error(`Unsupported spreadsheet target: ${target}`);
}
