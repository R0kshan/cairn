const ELK = require('elkjs');
const elk = new ELK();

// Synthetic hierarchical graph like an architecture diagram:
// C containers, N nodes each, labeled edges between random nodes across containers
function makeGraph(containers, nodesPer, edges) {
  const children = [];
  const ids = [];
  for (let c = 0; c < containers; c++) {
    const kids = [];
    for (let n = 0; n < nodesPer; n++) {
      const id = `c${c}_n${n}`;
      ids.push(id);
      kids.push({ id, width: 160, height: 60 });
    }
    children.push({ id: `container${c}`, children: kids });
  }
  const es = [];
  for (let e = 0; e < edges; e++) {
    const a = ids[(e * 7) % ids.length];
    let b = ids[(e * 13 + 5) % ids.length];
    if (a === b) b = ids[(e * 13 + 6) % ids.length];
    es.push({ id: `e${e}`, sources: [a], targets: [b],
      labels: [{ text: `Flux ${e}: demande de devis (JSON)`, width: 190, height: 16 }] });
  }
  return { id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.edgeLabels.sideSelection': 'ALWAYS_UP',
      'elk.edgeLabels.placement': 'CENTER',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN'
    },
    children, edges: es };
}

async function bench(name, containers, nodesPer, edges, runs = 5) {
  // warmup
  await elk.layout(makeGraph(containers, nodesPer, edges));
  const times = [];
  for (let i = 0; i < runs; i++) {
    const g = makeGraph(containers, nodesPer, edges);
    const t0 = process.hrtime.bigint();
    await elk.layout(g);
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  times.sort((x, y) => x - y);
  console.log(`${name}: ${containers * nodesPer} nodes, ${edges} labeled edges -> median ${times[Math.floor(runs/2)].toFixed(0)} ms (min ${times[0].toFixed(0)}, max ${times[runs-1].toFixed(0)})`);
}

(async () => {
  await bench('small ', 4, 5, 30);      // 20 nodes  — typical logical view
  await bench('medium', 6, 10, 90);     // 60 nodes  — big application view
  await bench('large ', 10, 15, 220);   // 150 nodes — worst case
  await bench('XL    ', 15, 20, 450);   // 300 nodes — beyond realistic
})();
