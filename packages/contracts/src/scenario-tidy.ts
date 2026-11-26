import type { Block } from './blocks.js';

type ScenarioPayload = Extract<Block, { type: 'branching_scenario' }>['payload'];

/**
 * Sistema e controlla un libro-game generato dall'AI prima di salvarlo.
 * Ripara ciò che si può (scelte senza testo o che puntano a scene inesistenti, ruoli, scene
 * irraggiungibili, scena iniziale mancante) e restituisce i problemi che lo rendono inutile
 * (va rigenerato): poche decisioni, scelte senza conseguenza scritta, nessun vero bivio, un solo esito.
 */
export function tidyBranchingScenario(input: ScenarioPayload): { payload: ScenarioPayload; problems: string[] } {
  const problems: string[] = [];
  const ids = new Set(input.nodes.map((n) => n.id));

  // Scelte: via quelle senza testo o che puntano a una scena che non c'è.
  const nodes = input.nodes.map((n) => {
    const choices = n.choices.filter((c) => c.label.trim() !== '' && (!c.nextNodeId || ids.has(c.nextNodeId)));
    const role: 'teach' | 'quiz' | undefined = choices.length >= 2 ? 'quiz' : choices.length === 1 ? 'teach' : undefined;
    return { ...n, choices: choices.map((c) => ({ ...c, label: c.label.trim() })), ...(role ? { role } : { role: undefined }) };
  });

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const startNodeId = byId.has(input.startNodeId) ? input.startNodeId : nodes[0]!.id;

  // Solo le scene raggiungibili dalla prima.
  const reachable = new Set<string>();
  const queue = [startNodeId];
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const c of byId.get(id)?.choices ?? []) if (c.nextNodeId) queue.push(c.nextNodeId);
  }
  const kept = nodes.filter((n) => reachable.has(n.id));

  const decisions = kept.filter((n) => n.choices.length >= 2);
  const endings = kept.filter((n) => n.choices.length === 0);
  if (decisions.length < 2) problems.push(`servono almeno 2 scene con una vera scelta (2-3 opzioni), ce ne sono ${decisions.length}`);
  if (endings.length < 2) problems.push(`servono almeno 2 scene finali (esito positivo e negativo), ce ne sono ${endings.length}`);
  for (const d of decisions) {
    if (d.choices.some((c) => !(c.feedback ?? '').trim())) problems.push(`la scena «${d.id}» ha scelte senza conseguenza scritta (feedback)`);
    const scores = d.choices.map((c) => c.score ?? 0);
    if (new Set(scores).size < 2) problems.push(`la scena «${d.id}» ha scelte con lo stesso punteggio: ci vuole una scelta migliore e una peggiore`);
    if (new Set(d.choices.map((c) => c.nextNodeId ?? '')).size < 2 && d.choices.every((c) => c.nextNodeId)) {
      problems.push(`la scena «${d.id}» manda tutte le scelte nella stessa scena`);
    }
  }
  const teachOnly = kept.filter((n) => n.choices.length === 1).length;
  if (teachOnly > Math.max(2, decisions.length)) problems.push('troppe scene con il solo «continua» rispetto alle scene con decisioni');

  return {
    payload: { ...input, startNodeId, nodes: kept, scored: true, pillole: true, gateChoicesOnMedia: true },
    problems,
  };
}

/**
 * Per una lezione «pillola interattiva»: tiene un solo libro-game, lo sistema e lo controlla.
 * Restituisce i blocchi aggiornati e i problemi da correggere con una nuova generazione.
 */
export function tidyPillolaInterattivaBlocks(blocks: Block[]): { blocks: Block[]; problems: string[] } {
  const idx = blocks.findIndex((b) => b.type === 'branching_scenario');
  if (idx < 0) return { blocks, problems: ['manca il libro-game (blocco branching_scenario)'] };
  const problems: string[] = [];
  const out: Block[] = [];
  blocks.forEach((b, i) => {
    if (b.type !== 'branching_scenario') return void out.push(b);
    if (i !== idx) return; // un solo libro-game per lezione
    const tidy = tidyBranchingScenario(b.payload);
    problems.push(...tidy.problems);
    out.push({ ...b, payload: tidy.payload });
  });
  return { blocks: out, problems };
}
