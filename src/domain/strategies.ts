import type { Candidato, ProfissionalDados, ProjetoDados, Ranking, RequisitoPapel } from './types.ts';
import { elegivel, normalizarTexto, similaridadeCompetencias } from './visitors.ts';

export interface RecomendacaoStrategy {
  recomendar(projeto: ProjetoDados, profissionais: ProfissionalDados[]): Ranking;
}

const media = (valores: number[], padrao = 0.5): number => valores.length ? valores.reduce((a, b) => a + b, 0) / valores.length : padrao;
const qualidade = (p: ProfissionalDados): number => media(p.avaliacoes.map(a => a.nota / 5));
const afinidade = (p: ProfissionalDados, projeto: ProjetoDados, papel: RequisitoPapel): number => media(p.historico.filter(h => h.papel === papel.papel).map(h => (Number(normalizarTexto(h.genero) === normalizarTexto(projeto.genero)) + Number(h.tipoCaptacao === projeto.tipoCaptacao)) / 2));
function ponderar(projeto: ProjetoDados, competencia: number, avaliacao: number, preco: number): number {
  const p = projeto.parametros;
  return (p.pesoCompetencia * competencia + p.pesoAvaliacao * avaliacao + p.pesoPreco * preco) / (p.pesoCompetencia + p.pesoAvaliacao + p.pesoPreco);
}
function candidato(p: ProfissionalDados, pontuacao: number, motivos: string[]): Candidato {
  return { profissionalId: p.id, nome: p.nome, precoCentavos: p.precoCentavos, pontuacao: Math.max(0, Math.min(1, pontuacao)), motivos };
}
function ranking(projeto: ProjetoDados, profissionais: ProfissionalDados[], pontuar: (p: ProfissionalDados, r: RequisitoPapel) => Candidato): Ranking {
  const resultado: Ranking = {};
  for (const requisito of projeto.papeis) resultado[requisito.papel] = profissionais.filter(p => elegivel(p, projeto, requisito)).map(p => pontuar(p, requisito)).sort((a, b) => b.pontuacao - a.pontuacao || a.precoCentavos - b.precoCentavos || a.profissionalId.localeCompare(b.profissionalId));
  return resultado;
}
function economia(p: ProfissionalDados, projeto: ProjetoDados): number { return 1 - Math.min(1, p.precoCentavos / Math.max(1, projeto.orcamentoCentavos)); }

export class SimilaridadeCosseno implements RecomendacaoStrategy {
  recomendar(projeto: ProjetoDados, profissionais: ProfissionalDados[]): Ranking {
    return ranking(projeto, profissionais, (p, r) => {
      const comp = similaridadeCompetencias(p, r);
      return candidato(p, ponderar(projeto, comp, qualidade(p), economia(p, projeto)), [`Competências: ${(comp * 100).toFixed(1)}% (cosseno × cobertura).`, `Avaliação média: ${(qualidade(p) * 5).toFixed(2)}/5.`]);
    });
  }
}

/** Filtragem colaborativa por vizinhança profissional–projeto.
 * A semelhança deriva de notas em produções em comum; a previsão usa as notas
 * dos vizinhos no contexto solicitado. Sem interseção, a previsão é neutra.
 */
export class FiltragemColaborativa implements RecomendacaoStrategy {
  recomendar(projeto: ProjetoDados, profissionais: ProfissionalDados[]): Ranking {
    const notas = new Map<string, Map<string, number>>();
    const porProducao = new Map<string, string[]>();
    const porId = new Map(profissionais.map(p => [p.id, p]));
    for (const p of profissionais) {
      const mapa = new Map(p.historico.filter(h => h.projetoId && h.nota !== undefined).map(h => [h.projetoId!, h.nota! / 5]));
      notas.set(p.id, mapa);
      for (const id of mapa.keys()) {
        const lista = porProducao.get(id) ?? [];
        // Limite determinístico para que uma produção com milhares de pessoas
        // não transforme uma recomendação em uma busca quadrática.
        if (lista.length < 64) lista.push(p.id);
        porProducao.set(id, lista);
      }
    }
    const previsoes = new Map<string, { nota: number; vizinhos: number }>();
    return ranking(projeto, profissionais, (p, requisito) => {
      const chave = `${p.id}:${requisito.papel}`;
      let previsao = previsoes.get(chave);
      if (!previsao) {
        const minhas = notas.get(p.id)!;
        const pares = new Set<string>();
        for (const id of minhas.keys()) for (const outro of porProducao.get(id) ?? []) if (outro !== p.id && pares.size < 64) pares.add(outro);
        const vizinhos: { peso: number; nota: number; id: string }[] = [];
        for (const id of pares) {
          const outras = notas.get(id)!;
          let quantidade = 0, distancia = 0;
          for (const [producao, nota] of minhas) if (outras.has(producao)) { quantidade++; distancia += Math.abs(nota - outras.get(producao)!); }
          const relevantes = porId.get(id)!.historico.filter(h => h.nota !== undefined && h.papel === requisito.papel && normalizarTexto(h.genero) === normalizarTexto(projeto.genero) && h.tipoCaptacao === projeto.tipoCaptacao);
          if (quantidade && relevantes.length) vizinhos.push({ id, peso: (1 - distancia / quantidade) * quantidade / (quantidade + 2), nota: media(relevantes.map(h => h.nota! / 5)) });
        }
        vizinhos.sort((a, b) => b.peso - a.peso || a.id.localeCompare(b.id));
        const proximos = vizinhos.filter(v => v.peso > 0).slice(0, 10);
        const soma = proximos.reduce((s, v) => s + v.peso, 0);
        previsao = { nota: soma ? proximos.reduce((s, v) => s + v.peso * v.nota, 0) / soma : 0.5, vizinhos: proximos.length };
        previsoes.set(chave, previsao);
      }
      const comp = 0.2 * similaridadeCompetencias(p, requisito) + 0.8 * previsao.nota;
      const score = ponderar(projeto, comp, 0.75 * previsao.nota + 0.25 * afinidade(p, projeto, requisito), economia(p, projeto));
      return candidato(p, score, [`Previsão colaborativa: ${(previsao.nota * 5).toFixed(2)}/5; ${previsao.vizinhos} vizinhos.`, previsao.vizinhos ? 'Vizinhos comparados por avaliações de produções em comum.' : 'Sem vizinhos suficientes: previsão neutra (início sem histórico).']);
    });
  }
}

export class RegrasOrcamento implements RecomendacaoStrategy {
  recomendar(projeto: ProjetoDados, profissionais: ProfissionalDados[]): Ranking {
    return ranking(projeto, profissionais, (p, r) => {
      const tecnica = ponderar(projeto, similaridadeCompetencias(p, r), qualidade(p), economia(p, projeto));
      const custo = economia(p, projeto);
      return candidato(p, 0.3 * tecnica + 0.7 * custo, [`Economia relativa ao orçamento: ${(custo * 100).toFixed(1)}%.`, '70% economia e 30% qualidade ponderada pelos parâmetros do projeto.']);
    });
  }
}

export function criarEstrategia(projeto: ProjetoDados): RecomendacaoStrategy {
  switch (projeto.estrategia) {
    case 'cosseno': return new SimilaridadeCosseno();
    case 'colaborativa': return new FiltragemColaborativa();
    case 'orcamento': return new RegrasOrcamento();
  }
}
