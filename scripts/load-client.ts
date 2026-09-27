import { performance } from 'node:perf_hooks';
import { projetoExemplo } from './fixtures.ts';
import type { EstadoProjeto, Estrategia } from '../src/domain/types.ts';

const base = process.argv[2]!;
const estrategia = process.argv[3] as Estrategia;
const quantidade = Number(process.argv[4] ?? 100);
const inicio = performance.now();
const resultados = await Promise.all(Array.from({ length: quantidade }, async (_, i) => {
  const projeto = { ...projetoExemplo(estrategia), titulo: `Carga ${estrategia} ${i}` };
  const t0 = performance.now();
  const resposta = await fetch(`${base}/projetos`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(projeto),
  });
  const estado = await resposta.json() as EstadoProjeto;
  const valido = resposta.status === 201 && !estado.recomendacao.degradada && estado.equipe.membros.length === 6
    && estado.equipe.custoCentavos <= projeto.orcamentoCentavos && new Set(estado.equipe.membros.map(m => m.profissionalId)).size === 6;
  return { ms: performance.now() - t0, valido };
}));
const tempos = resultados.map(r => r.ms).sort((a, b) => a - b);
console.log(JSON.stringify({
  estrategia, requisicoes: quantidade, simultaneas: quantidade, erros: resultados.filter(r => !r.valido).length,
  p50Ms: Math.round(tempos[Math.ceil(quantidade * 0.5) - 1]!), p95Ms: Math.round(tempos[Math.ceil(quantidade * 0.95) - 1]!),
  maxMs: Math.round(tempos.at(-1)!), totalMs: Math.round(performance.now() - inicio),
}));
