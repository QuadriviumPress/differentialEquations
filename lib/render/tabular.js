// render/tabular.js — parsed tabular block → HTML table.
//
// Cell text still carries math placeholders (protected before block
// segmentation), so cells render through the normal inline path.
import { renderInline, escapeHtml } from './inline.js';

export function renderTabular(block, ctx) {
  const rows = block.rows
    .map(row => {
      const cells = row.cells
        .map((cell, i) => {
          const align = block.columns[i] || 'left';
          return `<td class="align-${escapeHtml(align)}">${renderInline(cell, ctx)}</td>`;
        })
        .join('');
      return `<tr${row.topline ? ' class="topline"' : ''}>${cells}</tr>`;
    })
    .join('\n');
  const cls = `tabular${block.bottomline ? ' bottomline' : ''}`;
  return `<div class="tabular-wrap"><table class="${cls}"><tbody>\n${rows}\n</tbody></table></div>`;
}
