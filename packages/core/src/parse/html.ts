import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";

export type Doc = cheerio.CheerioAPI;

export function loadHtml(html: string): Doc {
  return cheerio.load(html);
}

export function textOf($: Doc, node: AnyNode | cheerio.Cheerio<AnyNode>): string {
  const element = $(node as AnyNode).clone();
  element.find("sup, script, style").remove();
  element.find("br").replaceWith("\n");
  element.find("li").each((_, li) => {
    $(li).append("；");
  });
  element.find("p, div").each((_, block) => {
    $(block).append("\n");
  });
  return element.text().replace(/\u200b/g, "").replace(/[ \t\r\f\v]+/g, " ").replace(/\s*\n\s*/g, "\n").replace(/；\s*$/, "").trim();
}

/** 把 <table> 展成二维格子，rowspan / colspan 会复制到被合并的位置。格子里的分段用换行隔开。 */
export function tableGrid($: Doc, table: Element): string[][] {
  const grid: string[][] = [];
  $(table).find("tr").each((rowIndex, tr) => {
    grid[rowIndex] ??= [];
    let column = 0;
    $(tr).children("td, th").each((_, cell) => {
      const row = grid[rowIndex] as string[];
      while (row[column] !== undefined) column += 1;
      const text = textOf($, cell);
      const rowSpan = Math.max(1, Number($(cell).attr("rowspan") ?? $(cell).attr("rowSpan") ?? 1) || 1);
      const colSpan = Math.max(1, Number($(cell).attr("colspan") ?? 1) || 1);
      for (let down = 0; down < rowSpan; down += 1) {
        grid[rowIndex + down] ??= [];
        for (let across = 0; across < colSpan; across += 1) {
          (grid[rowIndex + down] as string[])[column + across] = text;
        }
      }
      column += colSpan;
    });
  });
  return grid.map((row) => Array.from(row, (cell) => cell ?? ""));
}

/** 表头占几行：<thead> 里的行数，没有 <thead> 就算第一行。 */
export function headRowCount($: Doc, table: Element): number {
  return Math.max(1, $(table).find("thead tr").length);
}

/** 多行表头合成一行：同一列从上到下不重复地拼起来。 */
export function mergedHead(grid: readonly string[][], rows: number): string[] {
  const width = Math.max(0, ...grid.slice(0, rows).map((row) => row.length));
  return Array.from({ length: width }, (_, column) => {
    const parts: string[] = [];
    for (const row of grid.slice(0, rows)) {
      const text = (row[column] ?? "").replace(/\s+/g, " ").trim();
      if (text && !parts.includes(text)) parts.push(text);
    }
    return parts.join(" ");
  });
}

export function flat(cell: string): string {
  return cell.replace(/\s+/g, " ").trim();
}