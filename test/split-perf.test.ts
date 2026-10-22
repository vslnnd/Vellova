import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { gridOf, loadSource } from '../src/lib/split/engine/grid';
import { headerInfo } from '../src/lib/split/engine/header';
import { DEFAULT_SPLIT_RULES, planSplit } from '../src/lib/split/engine/planner';
import { writeOutputs } from '../src/lib/split/engine/write';

// Runs only with PERF=1: 50,000 rows x 20 columns, split by value into 20 groups.
describe.skipIf(!process.env.PERF)('split performance', () => {
  it('splits a 50,000 x 20 styled workbook in under 10 s', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Data');
    ws.addRow(Array.from({ length: 20 }, (_, c) => (c === 0 ? 'Group' : `Col${c}`)));
    ws.getRow(1).font = { bold: true };
    for (let r = 0; r < 50000; r++) {
      const row = ws.addRow(Array.from({ length: 20 }, (_, c) => (c === 0 ? `G${r % 20}` : c % 2 ? r * c : `text ${r}-${c}`)));
      row.getCell(2).numFmt = '#,##0.00';
      row.getCell(3).font = { italic: true };
    }
    const bytes = new Uint8Array(await wb.xlsx.writeBuffer());

    const t0 = performance.now();
    const src = await loadSource('.xlsx', bytes);
    const grid = gridOf(src, null);
    const rules = {
      ...DEFAULT_SPLIT_RULES, column: 'Group',
      params: Array.from({ length: 20 }, (_, i) => ({ value: `G${i}`, label: '', payable: true })),
    };
    const info = headerInfo(grid, rules.header);
    const path = 'C:\in\Big.xlsx';
    const items = planSplit({
      files: [path], reads: { [path]: { ok: true, grid } }, rules, columnFor: {},
      skipped: new Set(), existing: new Set(), date: new Date(2026, 9, 17),
    });
    const outputs = items.flatMap((i) => (i.spec ? [i.spec] : []));
    const out = await writeOutputs(src, { sheet: null, header: info.row, format: 'xlsx', delimiter: ',', outputs });
    const secs = (performance.now() - t0) / 1000;
    console.log(`PERF split: ${secs.toFixed(2)} s`);
    expect(out).toHaveLength(20);
    expect(secs).toBeLessThan(10);
  }, 120000);
});
