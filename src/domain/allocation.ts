import type { Candidato, MembroEquipe, Papel, ProjetoDados, Ranking, RequisitoPapel } from './types.ts';

interface Escolha { requisito: RequisitoPapel; candidato: Candidato }
interface Estado { valor: number; custo: number; escolhas: Escolha[] }
type Objetivo = (candidato: Candidato, requisito: RequisitoPapel) => number;

/** Para até seis papéis, conservar os seis melhores candidatos de cada papel
 * basta para a atribuição ótima de um objetivo aditivo: no máximo cinco desses
 * candidatos podem estar ocupados em outros papéis. A programação dinâmica
 * percorre cada pessoa uma vez e usa uma máscara dos papéis já preenchidos.
 */
function atribuicoes(requisitos: RequisitoPapel[], ranking: Ranking, objetivo: Objetivo): (Estado | undefined)[] {
  const pessoas = new Map<string, { indice: number; candidato: Candidato; valor: number }[]>();
  for (const [indice, requisito] of requisitos.entries()) {
    const melhores: { candidato: Candidato; valor: number }[] = [];
    for (const candidato of ranking[requisito.papel] ?? []) {
      const item = { candidato, valor: objetivo(candidato, requisito) };
      const posicao = melhores.findIndex(m => item.valor > m.valor || (item.valor === m.valor && candidato.profissionalId < m.candidato.profissionalId));
      if (posicao >= 0) melhores.splice(posicao, 0, item);
      else if (melhores.length < requisitos.length) melhores.push(item);
      if (melhores.length > requisitos.length) melhores.pop();
    }
    for (const item of melhores) {
      const opcoes = pessoas.get(item.candidato.profissionalId) ?? [];
      opcoes.push({ indice, ...item }); pessoas.set(item.candidato.profissionalId, opcoes);
    }
  }
  const estados: (Estado | undefined)[] = Array.from({ length: 1 << requisitos.length });
  estados[0] = { valor: 0, custo: 0, escolhas: [] };
  for (const opcoes of pessoas.values()) {
    // Ordem decrescente: uma pessoa não pode reaparecer no mesmo estado.
    for (let mascara = estados.length - 1; mascara >= 0; mascara--) {
      const atual = estados[mascara];
      if (!atual) continue;
      for (const opcao of opcoes) {
        if (mascara & (1 << opcao.indice)) continue;
        const proxima = mascara | (1 << opcao.indice);
        const valor = atual.valor + opcao.valor, custo = atual.custo + opcao.candidato.precoCentavos;
        const anterior = estados[proxima];
        if (!anterior || valor > anterior.valor || (valor === anterior.valor && custo < anterior.custo)) estados[proxima] = { valor, custo, escolhas: [...atual.escolhas, { requisito: requisitos[opcao.indice]!, candidato: opcao.candidato }] };
      }
    }
  }
  return estados;
}

function utilidade(e: Estado): number { return e.escolhas.reduce((s, v) => s + v.requisito.peso * v.candidato.pontuacao, 0); }
function importancia(e: Estado): number { return e.escolhas.reduce((s, v) => s + v.requisito.peso, 0); }
function melhor(a: Estado, b: Estado): boolean {
  return a.escolhas.length > b.escolhas.length || (a.escolhas.length === b.escolhas.length && (importancia(a) > importancia(b) || (importancia(a) === importancia(b) && (utilidade(a) > utilidade(b) || (utilidade(a) === utilidade(b) && a.custo < b.custo)))));
}

export function alocar(projeto: ProjetoDados, ranking: Ranking, fixos: MembroEquipe[]): { membros: MembroEquipe[]; papeisPendentes: Papel[] } {
  const requisitos = projeto.papeis.filter(r => !fixos.some(f => f.papel === r.papel));
  const disponivel = projeto.orcamentoCentavos - fixos.reduce((s, f) => s + f.precoCentavos, 0);
  let escolhido: Estado = { valor: 0, custo: 0, escolhas: [] };
  // Este primeiro objetivo garante encontrar uma equipe completa quando ela
  // existe dentro do orçamento; não depende do limite de candidatos exibidos.
  const baratos = atribuicoes(requisitos, ranking, c => -c.precoCentavos);
  for (const estado of baratos) if (estado && estado.custo <= disponivel && melhor(estado, escolhido)) escolhido = estado;
  const somaPesos = requisitos.reduce((s, r) => s + r.peso, 0) || 1;
  // A qualidade sob teto de gastos usa busca limitada por penalidades de custo.
  // A viabilidade acima é exata; a maior pontuação sob o teto é aproximada.
  for (const penalidade of [0, 0.05, 0.2, 0.5, 1, 2, 8, 32]) {
    const estados = atribuicoes(requisitos, ranking, (c, r) => c.pontuacao * r.peso / somaPesos - penalidade * c.precoCentavos / Math.max(1, disponivel));
    for (const estado of estados) if (estado && estado.custo <= disponivel && melhor(estado, escolhido)) escolhido = estado;
    const completo = estados.at(-1);
    if (penalidade === 0 && completo && completo.custo <= disponivel) break;
  }
  const membros = [...fixos.map(f => ({ ...f })), ...escolhido.escolhas.map(({ requisito, candidato }): MembroEquipe => ({ papel: requisito.papel, profissionalId: candidato.profissionalId, precoCentavos: candidato.precoCentavos, pontuacao: candidato.pontuacao, aceitoProdutor: false, confirmado: false }))];
  membros.sort((a, b) => projeto.papeis.findIndex(r => r.papel === a.papel) - projeto.papeis.findIndex(r => r.papel === b.papel));
  return { membros, papeisPendentes: projeto.papeis.map(r => r.papel).filter(p => !membros.some(m => m.papel === p)) };
}
