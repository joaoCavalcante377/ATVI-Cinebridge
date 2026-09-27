import { pathToFileURL } from 'node:url';
import { OrquestradorPadrao, PARAMETROS_PADRAO, ESTRATEGIAS } from '../src/domain/index.ts';
import type { ProjetoDados, ProfissionalDados, Historico } from '../src/domain/index.ts';

/** Rótulos de uma banca fictícia, escritos à parte da pontuação dos algoritmos.
 * Esta pequena fixture verifica o cálculo da métrica; não estima qualidade real.
 */
export function avaliarFixtureSintetica() {
  const projeto: ProjetoDados = {
    id: 'avaliacao-sintetica', titulo: 'Curta de teste', genero: 'drama', duracaoMinutos: 15,
    orcamentoCentavos: 10000, inicio: '2026-10-01', prazo: '2026-10-20', tipoCaptacao: 'ficcao', localizacao: 'São Paulo',
    papeis: [{ papel: 'DIRETOR', peso: 1, competencias: [{ nome: 'direcao', nivel: 5 }] }], estrategia: 'cosseno', parametros: { ...PARAMETROS_PADRAO, limiteCandidatos: 3 },
  };
  const producao = (id: string, nota: number, genero = 'comedia'): Historico => ({ projetoId: id, nota, genero, papel: 'DIRETOR', tipoCaptacao: 'ficcao' });
  const pessoa = (id: string, nivel: number, preco: number, nota: number, historico: Historico[] = [], localizacao = 'São Paulo'): ProfissionalDados => ({
    id, nome: id, email: `${id}@example.test`, papeis: ['DIRETOR'], competencias: [{ nome: 'direcao', nivel }], precoCentavos: preco,
    disponibilidade: { inicio: '2026-01-01', fim: '2026-12-31' }, localizacao, avaliacoes: [{ nota, comentario: 'Dado sintético', data: '2026-01-01' }], historico,
  });
  const profissionais = [
    pessoa('ana', 5, 8000, 5, [producao('ponte-a', 5)]),
    pessoa('bia', 4, 4000, 4, [producao('ponte-b', 5)]),
    pessoa('caio', 3, 1000, 3, [producao('ponte-c', 5)]),
    pessoa('davi', 1, 500, 2), pessoa('eva', 4, 5500, 4), pessoa('fabio', 2, 1500, 2),
    pessoa('vizinho-a', 5, 1000, 5, [producao('ponte-a', 5), producao('drama-a', 2, 'drama')], 'Recife'),
    pessoa('vizinho-b', 5, 1000, 5, [producao('ponte-b', 5), producao('drama-b', 5, 'drama')], 'Recife'),
    pessoa('vizinho-c', 5, 1000, 5, [producao('ponte-c', 5), producao('drama-c', 4, 'drama')], 'Recife'),
  ];
  // Três profissionais considerados relevantes por hipótese externa ao score.
  const relevantes = new Set(['ana', 'bia', 'eva']);
  const orquestrador = new OrquestradorPadrao();
  return {
    natureza: 'Fixture sintética e pequena; não representa precisão em produção.',
    criterio: 'precision@3 = quantidade de IDs relevantes nos três primeiros / 3',
    relevantes: [...relevantes],
    resultados: ESTRATEGIAS.map(estrategia => {
      const r = orquestrador.orquestrar({ ...projeto, estrategia }, profissionais);
      const top3 = (r.candidatos.DIRETOR ?? []).slice(0, 3).map(c => c.profissionalId);
      return { estrategia, top3, precisionAt3: top3.filter(id => relevantes.has(id)).length / 3 };
    }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(avaliarFixtureSintetica(), null, 2));
