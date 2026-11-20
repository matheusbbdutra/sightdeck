/** Árvore do painel "Arquivos da pasta": funções puras, sem DOM.
 *  A lista vem do Rust (`project_files`) como paths relativos ao `cwd`. */

/** Nó: `{ name, path, dir, children }`. Diretórios antes de arquivos, A–Z. */
export function buildTree(paths) {
  const root = { name: '', path: '', dir: true, children: [] };
  const dirs = new Map([['', root]]);

  for (const raw of paths || []) {
    const path = String(raw || '').replace(/\\/g, '/').replace(/^\/+/, '');
    const parts = path.split('/').filter(Boolean);
    if (!parts.length) continue;
    let cur = root;
    let acc = '';
    parts.forEach((part, i) => {
      acc = acc ? acc + '/' + part : part;
      if (i === parts.length - 1) {
        cur.children.push({ name: part, path: acc, dir: false, children: [] });
        return;
      }
      let node = dirs.get(acc);
      if (!node) {
        node = { name: part, path: acc, dir: true, children: [] };
        dirs.set(acc, node);
        cur.children.push(node);
      }
      cur = node;
    });
  }

  sortTree(root);
  return root;
}

function sortTree(node) {
  node.children.sort((a, b) => {
    if (a.dir !== b.dir) return a.dir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const c of node.children) if (c.dir) sortTree(c);
}

/** Filas visíveis para render: `[{name, path, dir, depth}]`.
 *  Com filtro, lista plana dos arquivos que casam (teto de 200);
 *  sem filtro, DFS respeitando os diretórios abertos (`open`: Set/array de paths). */
export function visibleRows(tree, open, filter) {
  const q = String(filter || '').trim().toLowerCase();
  const isOpen = (p) => (open instanceof Set ? open.has(p) : Array.isArray(open) && open.includes(p));

  if (q) {
    const hits = [];
    const walk = (n) => {
      for (const c of n.children) {
        if (c.dir) walk(c);
        else if (c.path.toLowerCase().includes(q)) hits.push(c);
      }
    };
    walk(tree);
    return hits.slice(0, 200).map((c) => ({ name: c.name, path: c.path, dir: false, depth: 0 }));
  }

  const rows = [];
  const walk = (n, depth) => {
    for (const c of n.children) {
      rows.push({ name: c.name, path: c.path, dir: c.dir, depth });
      if (c.dir && isOpen(c.path)) walk(c, depth + 1);
    }
  };
  walk(tree, 0);
  return rows;
}
