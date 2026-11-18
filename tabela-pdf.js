// Lê o PDF da tabela de preços da Serrana Agrícola (formato FastReport/WAIS)
// e devolve {data: 'AAAA-MM-DD', produtos: [[codigo, nome, categoria, p30, p60, descMax], ...]}
export async function lerTabelaPdf(pdfjs, dados) {
  const pdf = await pdfjs.getDocument({ data: dados }).promise;
  const linhas = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const pag = await pdf.getPage(n);
    const tc = await pag.getTextContent();
    const itens = tc.items.filter(i => i.str && i.str.trim()).map(i => ({ x: i.transform[4], y: i.transform[5], s: i.str }));
    itens.sort((a, b) => b.y - a.y || a.x - b.x);
    let atual = null;
    for (const it of itens) {
      if (atual && Math.abs(atual.y - it.y) <= 3) atual.p.push(it);
      else { atual = { y: it.y, p: [it] }; linhas.push(atual); }
    }
  }
  return interpretarLinhas(linhas.map(l => l.p.sort((a, b) => a.x - b.x).map(i => i.s.trim()).join('  ')));
}

const num = s => parseFloat(s.replace(/\./g, '').replace(',', '.'));

export function interpretarLinhas(linhas) {
  let data = null, cat = null;
  const produtos = [], vistos = new Set(), contagens = [];
  for (let l of linhas) {
    l = l.replace(/\s+/g, ' ').trim();
    let m = l.match(/Tabela de Pre[cç]os\s*-\s*(\d{2})\/(\d{2})\/(\d{4})/i);
    if (m) { data = `${m[3]}-${m[2]}-${m[1]}`; continue; }
    m = l.match(/^(\d{6})(\*?) (.+?) (\d{1,3}(?:\.\d{3})*,\d{2}) (\d{1,3}(?:\.\d{3})*,\d{2}) (\d{1,3}(?:\.\d{3})*,\d{2})$/);
    if (m) {
      if (!cat) continue;
      if (vistos.has(m[1])) continue;
      vistos.add(m[1]);
      produtos.push([m[1], m[3].trim(), cat, num(m[5]), num(m[6]), num(m[4])]);
      continue;
    }
    m = l.match(/^\d{6} - (.+)$/);
    if (m) { cat = m[1].trim().toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase()); continue; }
    m = l.match(/^(\d+) produto\(s\)$/);
    if (m) contagens.push(+m[1]);
  }
  const esperado = contagens.reduce((a, b) => a + b, 0);
  return { data, produtos, esperado };
}
