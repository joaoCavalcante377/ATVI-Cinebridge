import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OrquestradorPadrao, Projeto, Profissional, ValidadorConsistencia, CalculadorCompatibilidade, GeradorRelatorio, PARAMETROS_PADRAO, SimilaridadeCosseno, FiltragemColaborativa, RegrasOrcamento, dataValida, similaridadeCompetencias } from '../src/domain/index.ts';
import type { ProjetoDados, ProfissionalDados, MembroEquipe, Ranking, ResultadoOrquestracao, Papel } from '../src/domain/index.ts';
import { avaliarFixtureSintetica } from '../scripts/evaluate.ts';

function projeto(patch: Partial<ProjetoDados> = {}): ProjetoDados {
  return { id: 'p1', titulo: 'Memórias', genero: 'drama', duracaoMinutos: 20, orcamentoCentavos: 10000, inicio: '2026-10-01', prazo: '2026-10-10', tipoCaptacao: 'ficcao', localizacao: 'São Paulo', papeis: [{ papel: 'DIRETOR', peso: 1, competencias: [{ nome: 'direção', nivel: 5 }] }], estrategia: 'cosseno', parametros: { ...PARAMETROS_PADRAO }, ...patch };
}
function profissional(id: string, patch: Partial<ProfissionalDados> = {}): ProfissionalDados {
  return { id, nome: `Pessoa ${id}`, email: `${id}@example.test`, papeis: ['DIRETOR'], competencias: [{ nome: 'direção', nivel: 5 }], precoCentavos: 1000, disponibilidade: { inicio: '2026-01-01', fim: '2026-12-31' }, localizacao: 'sao paulo', historico: [], avaliacoes: [{ nota: 4, comentario: '', data: '2026-01-01' }], ...patch };
}
const orquestrador = new OrquestradorPadrao();

test('Strategy muda a recomendação sem alterar o projeto original', () => {
  const p = projeto();
  const profissionais = [profissional('tecnico', { precoCentavos: 7000 }), profissional('economico', { precoCentavos: 1000, competencias: [{ nome: 'direção', nivel: 2 }] })];
  assert.equal(orquestrador.orquestrar(p, profissionais).equipe.membros[0]?.profissionalId, 'tecnico');
  assert.equal(orquestrador.orquestrar({ ...p, estrategia: 'orcamento' }, profissionais).equipe.membros[0]?.profissionalId, 'economico');
  assert.equal(p.estrategia, 'cosseno');
});

test('cosseno penaliza a falta de proficiência e competência ausente', () => {
  const p = projeto();
  assert.equal(similaridadeCompetencias(profissional('a', { competencias: [{ nome: 'DIRECAO', nivel: 1 }] }), p.papeis[0]!), 0.2);
  assert.equal(similaridadeCompetencias(profissional('a', { competencias: [] }), p.papeis[0]!), 0);
  assert.equal(similaridadeCompetencias(profissional('a'), { papel: 'DIRETOR', peso: 1, competencias: [] }), 1);
  assert.equal(similaridadeCompetencias(profissional('a'), { papel: 'DIRETOR', peso: 1, competencias: [{ nome: 'direção', nivel: 0 }] }), 1);
});

test('colaborativa usa notas de vizinhos em produções compartilhadas', () => {
  const comum = (projetoId: string, nota: number) => ({ projetoId, nota, genero: 'comedia', tipoCaptacao: 'ficcao' as const, papel: 'DIRETOR' as const });
  const alvo = (projetoId: string, nota: number) => ({ projetoId, nota, genero: 'drama', tipoCaptacao: 'ficcao' as const, papel: 'DIRETOR' as const });
  const a = profissional('a', { historico: [comum('historia-a', 5)], avaliacoes: [{ nota: 5, comentario: '', data: '2026-01-01' }] });
  const b = profissional('b', { historico: [comum('historia-b', 5)], avaliacoes: [{ nota: 1, comentario: '', data: '2026-01-01' }] });
  // Vizinhos fora da cidade informam o modelo, mas não são candidatos.
  const pares = [profissional('par-a', { localizacao: 'Recife', historico: [comum('historia-a', 5), alvo('alvo-a', 1)] }), profissional('par-b', { localizacao: 'Recife', historico: [comum('historia-b', 5), alvo('alvo-b', 5)] })];
  const dados = [a, b, ...pares];
  assert.equal(new SimilaridadeCosseno().recomendar(projeto(), dados).DIRETOR?.[0]?.profissionalId, 'a');
  assert.equal(new FiltragemColaborativa().recomendar(projeto(), dados).DIRETOR?.[0]?.profissionalId, 'b');
  const semHistorico = new FiltragemColaborativa().recomendar(projeto(), [profissional('novo', { avaliacoes: [] })]);
  assert.match(semHistorico.DIRETOR![0]!.motivos.join(' '), /previsão neutra/);
  const todosDiferentes = new FiltragemColaborativa().recomendar(projeto(), [a, profissional('par-zero', { historico: [comum('historia-a', 0), alvo('alvo-x', 5)] })]);
  assert.ok(todosDiferentes.DIRETOR?.every(c => Number.isFinite(c.pontuacao)));
});

test('filtros obrigatórios respeitam cidade, papel e o período inteiro', () => {
  const resultado = orquestrador.orquestrar(projeto(), [profissional('cidade', { localizacao: 'Recife' }), profissional('papel', { papeis: ['EDITOR'] }), profissional('atrasado', { disponibilidade: { inicio: '2026-10-02', fim: '2026-12-31' } }), profissional('cedo', { disponibilidade: { inicio: '2026-01-01', fim: '2026-10-09' } }), profissional('remoto', { localizacao: 'Remoto' })]);
  assert.deepEqual(resultado.equipe.membros.map(m => m.profissionalId), ['remoto']);
  assert.equal(orquestrador.orquestrar(projeto({ localizacao: 'remoto' }), [profissional('longe', { localizacao: 'Recife' })]).equipe.membros.length, 1);
});

test('alocação evita escolha gulosa que impediria uma equipe viável', () => {
  const p = projeto({ orcamentoCentavos: 2000, papeis: [{ papel: 'DIRETOR', peso: 3, competencias: [] }, { papel: 'EDITOR', peso: 1, competencias: [] }] });
  const resultado = orquestrador.orquestrar(p, [profissional('a-versatil', { papeis: ['DIRETOR', 'EDITOR'] }), profissional('z-diretor')]);
  assert.deepEqual(resultado.equipe.membros.map(m => [m.papel, m.profissionalId]), [['DIRETOR', 'z-diretor'], ['EDITOR', 'a-versatil']]);
  assert.equal(resultado.equipe.status, 'SUGERIDA');
  assert.equal(resultado.equipe.custoCentavos, 2000);
});

test('busca equipe completa além do limite exibido e sem ultrapassar orçamento', () => {
  const p = projeto({ parametros: { ...PARAMETROS_PADRAO, limiteCandidatos: 1 }, orcamentoCentavos: 2000, papeis: [{ papel: 'DIRETOR', peso: 2, competencias: [{ nome: 'direção', nivel: 5 }] }, { papel: 'EDITOR', peso: 1, competencias: [] }] });
  const caros = Array.from({ length: 12 }, (_, i) => profissional(`caro-${i}`, { precoCentavos: 9000 }));
  const resultado = orquestrador.orquestrar(p, [...caros, profissional('barato', { competencias: [{ nome: 'direção', nivel: 1 }] }), profissional('editor', { papeis: ['EDITOR'] })]);
  assert.equal(resultado.candidatos.DIRETOR?.length, 1);
  assert.equal(resultado.equipe.membros.length, 2);
  assert.equal(resultado.equipe.custoCentavos, 2000);
  assert.ok(resultado.equipe.membros.some(m => m.profissionalId === 'barato'));
});

test('equipe parcial prioriza papel de maior peso e sinaliza motivo', () => {
  const p = projeto({ orcamentoCentavos: 1000, papeis: [{ papel: 'DIRETOR', peso: 1, competencias: [] }, { papel: 'EDITOR', peso: 5, competencias: [] }] });
  const r = orquestrador.orquestrar(p, [profissional('diretor'), profissional('editor', { papeis: ['EDITOR'] })]);
  assert.equal(r.equipe.status, 'PARCIAL');
  assert.equal(r.equipe.membros[0]?.papel, 'EDITOR');
  assert.deepEqual(r.equipe.papeisPendentes, ['DIRETOR']);
  assert.match(r.avisos.join(' '), /Equipe parcial/);
  const vazio = orquestrador.orquestrar(projeto(), []);
  assert.equal(vazio.equipe.custoCentavos, 0);
});

test('substituição preserva valores e confirmações dos fixos e exclui recusados', () => {
  const p = projeto({ papeis: [{ papel: 'DIRETOR', peso: 1, competencias: [] }, { papel: 'EDITOR', peso: 1, competencias: [] }] });
  const fixo: MembroEquipe = { papel: 'DIRETOR', profissionalId: 'diretor', precoCentavos: 500, pontuacao: 0.83, aceitoProdutor: true, confirmado: true };
  const ps = [profissional('diretor'), profissional('editor-a', { papeis: ['EDITOR'] }), profissional('editor-b', { papeis: ['EDITOR'] })];
  const r = orquestrador.orquestrar(p, ps, { fixos: [fixo], excluidos: { EDITOR: ['editor-a'] } });
  assert.deepEqual(r.equipe.membros[0], fixo);
  assert.equal(r.equipe.membros[1]?.profissionalId, 'editor-b');
  const fixos = r.equipe.membros.map(m => ({ ...m, aceitoProdutor: true, confirmado: false }));
  assert.equal(orquestrador.orquestrar(p, ps, { fixos }).equipe.status, 'AGUARDANDO');
  assert.equal(orquestrador.orquestrar(p, ps, { fixos: fixos.map(m => ({ ...m, confirmado: true })) }).equipe.status, 'CONFIRMADA');
  assert.throws(() => orquestrador.orquestrar(p, ps, { fixos: [fixo, fixo] }), /repetem/);
  assert.throws(() => orquestrador.orquestrar(p, ps, { fixos: [{ ...fixo, profissionalId: 'inexistente' }] }), /elegível/);
  assert.throws(() => orquestrador.orquestrar(p, ps, { fixos: [{ ...fixo, precoCentavos: -1 }] }), /inválido/);
  assert.throws(() => orquestrador.orquestrar(p, ps, { fixos: [{ ...fixo, pontuacao: Number.NaN }] }), /inválido/);
  assert.throws(() => orquestrador.orquestrar(p, ps, { fixos: [{ ...fixo, precoCentavos: 20000 }] }), /ultrapassam/);
  assert.throws(() => orquestrador.orquestrar(p, ps, { fixos: [fixo], excluidos: { DIRETOR: ['diretor'] } }), /elegível/);
});

test('Visitor valida, calcula e relata pelos dois tipos de elemento', () => {
  const p = projeto(), pessoa = profissional('a');
  const pr = new Projeto(p), pf = new Profissional(pessoa);
  assert.deepEqual(pr.aceitar(new ValidadorConsistencia()), []);
  assert.deepEqual(pf.aceitar(new ValidadorConsistencia()), []);
  assert.equal(pr.aceitar(new CalculadorCompatibilidade(p, [pessoa])), 1);
  assert.equal(pf.aceitar(new CalculadorCompatibilidade(p)), 1);
  assert.equal(new Projeto(projeto({ papeis: [] })).aceitar(new CalculadorCompatibilidade(p)), 0);
  assert.equal(new Profissional(profissional('a', { papeis: ['EDITOR'] })).aceitar(new CalculadorCompatibilidade(p)), 0);
  assert.match(pr.aceitar(new GeradorRelatorio()), /Memórias.*100.00/);
  assert.match(pf.aceitar(new GeradorRelatorio()), /Pessoa a.*10.00/);
});

test('Visitors verificam composição real, inclusive papéis e custos pendentes', () => {
  const p = projeto({ papeis: [{ papel: 'DIRETOR', peso: 3, competencias: [{ nome: 'direção', nivel: 5 }] }, { papel: 'EDITOR', peso: 1, competencias: [] }] });
  const ps = [profissional('diretor'), profissional('editor', { papeis: ['EDITOR'] })];
  const equipe = orquestrador.orquestrar(p, ps).equipe;
  const pr = new Projeto(p);
  assert.deepEqual(pr.aceitar(new ValidadorConsistencia(equipe)), []);
  assert.equal(pr.aceitar(new CalculadorCompatibilidade(p, ps, equipe)), 1);
  const parcial = { ...equipe, membros: equipe.membros.slice(0, 1), papeisPendentes: ['EDITOR' as const], custoCentavos: 1000 };
  assert.equal(pr.aceitar(new CalculadorCompatibilidade(p, ps, parcial)), 0.75);
  assert.match(pr.aceitar(new ValidadorConsistencia(parcial)).join(' '), /todos os papéis/);
  const inconsistente = { ...equipe, projetoId: 'outro', custoCentavos: 999, papeisPendentes: ['SONOPLASTA' as const], status: 'CONFIRMADA' as const, membros: [...equipe.membros, { ...equipe.membros[0]!, papel: 'SONOPLASTA' as const }] };
  const erros = pr.aceitar(new ValidadorConsistencia(inconsistente)).join(' ');
  for (const trecho of ['outro projeto', 'não solicitado', 'repete', 'Custo', 'pendentes inconsistente', 'confirmada']) assert.ok(erros.includes(trecho), trecho);
  const relatorio = pr.aceitar(new GeradorRelatorio(equipe, ps));
  assert.match(relatorio, /Pessoa diretor/);
  assert.match(relatorio, /Custo total: R\$ 20.00/);
  assert.match(relatorio, /nenhum/);
  assert.match(pr.aceitar(new GeradorRelatorio(parcial)), /EDITOR/);
});

test('falha de cadastro preserva membros existentes e explica o limite', () => {
  const p = projeto({ papeis: [{ papel: 'DIRETOR', peso: 1, competencias: [] }, { papel: 'EDITOR', peso: 1, competencias: [] }] });
  const fixo: MembroEquipe = { papel: 'DIRETOR', profissionalId: 'diretor', precoCentavos: 500, pontuacao: 0.83, aceitoProdutor: true, confirmado: true };
  const r = orquestrador.orquestrar(p, [], { fixos: [fixo], cadastroIndisponivel: true });
  assert.deepEqual(r.equipe.membros, [fixo]);
  assert.equal(r.equipe.status, 'PARCIAL');
  assert.match(r.avisos.join(' '), /não pôde ser revalidada/);
});

test('métrica sintética usa rótulos explícitos e revela diferença entre estratégias', () => {
  const resultado = avaliarFixtureSintetica();
  assert.equal(resultado.resultados.length, 3);
  assert.equal(resultado.resultados[0]?.precisionAt3, 1);
  assert.ok(resultado.resultados.some(r => r.precisionAt3 < 1));
  for (const r of resultado.resultados) assert.equal(r.precisionAt3, r.top3.filter(id => resultado.relevantes.includes(id)).length / 3);
});

test('datas de calendário e valores de domínio são validados', () => {
  assert.equal(dataValida('2026-02-30'), false);
  assert.equal(dataValida('2024-02-29'), true);
  assert.equal(dataValida('2026-13-01'), false);
  assert.equal(dataValida('01/10/2026'), false);
  const ruins: Partial<ProjetoDados>[] = [ { id: '' }, { duracaoMinutos: 0 }, { orcamentoCentavos: 1.5 }, { inicio: '2026-02-30' }, { prazo: '2026-01-01' }, { tipoCaptacao: 'outro' as ProjetoDados['tipoCaptacao'] }, { estrategia: 'outro' as ProjetoDados['estrategia'] }, { papeis: [] }, { papeis: [{ papel: 'INVALIDO' as Papel, peso: 0, competencias: [] }] }, { parametros: { ...PARAMETROS_PADRAO, pesoPreco: -1 } }, { parametros: { pesoCompetencia: 0, pesoAvaliacao: 0, pesoPreco: 0, limiteCandidatos: 0 } } ];
  for (const ruim of ruins) assert.throws(() => orquestrador.orquestrar(projeto(ruim), []));
  const dadosRuins: Partial<ProfissionalDados>[] = [{ email: 'x' }, { precoCentavos: -1 }, { papeis: [] }, { papeis: ['DIRETOR', 'DIRETOR'] }, { competencias: [{ nome: 'x', nivel: 6 }] }, { competencias: [{ nome: 'x', nivel: 1 }, { nome: ' X ', nivel: 1 }] }, { disponibilidade: { inicio: '2026-02-30', fim: '2026-12-31' } }, { avaliacoes: [{ nota: 8, comentario: '', data: '2026-01-01' }] }, { historico: [{ genero: '', papel: 'DIRETOR', tipoCaptacao: 'ficcao', nota: -1 }] }];
  for (const ruim of dadosRuins) assert.notEqual(new Profissional(profissional('x', ruim)).aceitar(new ValidadorConsistencia()).length, 0);
  const r = orquestrador.orquestrar(projeto(), [profissional('a'), profissional('a'), profissional('invalido', { precoCentavos: -1 })]);
  assert.equal(r.candidatos.DIRETOR?.length, 1);
  assert.match(r.avisos[0]!, /2 cadastro/);
});

test('Template Method mantém ordem e não permite substituir orquestrar', () => {
  class ComRastro extends OrquestradorPadrao {
    rastro: string[] = [];
    protected override validarRestricoes(p: ProjetoDados): void { this.rastro.push('validar'); super.validarRestricoes(p); }
    protected override normalizarDados(p: ProjetoDados, ps: ProfissionalDados[]) { this.rastro.push('normalizar'); return super.normalizarDados(p, ps); }
    protected override posProcessar(p: ProjetoDados, ranking: Ranking, fixos: MembroEquipe[], avisos: string[]): ResultadoOrquestracao { this.rastro.push('pós-processar'); return super.posProcessar(p, ranking, fixos, avisos); }
  }
  const instancia = new ComRastro();
  instancia.orquestrar(projeto(), [profissional('a')]);
  assert.deepEqual(instancia.rastro, ['validar', 'normalizar', 'pós-processar']);
  assert.throws(() => Object.defineProperty(instancia, 'orquestrar', { value: () => null }), TypeError);
});

test('custo zero, pesos personalizados e limites mantêm números finitos', () => {
  const p = projeto({ orcamentoCentavos: 0, parametros: { pesoCompetencia: 1, pesoAvaliacao: 0, pesoPreco: 0, limiteCandidatos: 100 } });
  const p1 = profissional('a', { precoCentavos: 0, avaliacoes: [], historico: [{ genero: 'drama', tipoCaptacao: 'ficcao', papel: 'DIRETOR' }] });
  assert.equal(orquestrador.orquestrar(p, [p1]).equipe.membros.length, 1);
  assert.ok(Number.isFinite(new RegrasOrcamento().recomendar(p, [p1]).DIRETOR![0]!.pontuacao));
  assert.ok(Number.isFinite(new FiltragemColaborativa().recomendar(p, [p1]).DIRETOR![0]!.pontuacao));
});

test('viabilidade da alocação coincide com busca exaustiva em catálogos pequenos', () => {
  let estado = 7349;
  const aleatorio = () => { estado = (estado * 1664525 + 1013904223) >>> 0; return estado / 2 ** 32; };
  const papeis: Papel[] = ['DIRETOR', 'EDITOR', 'SONOPLASTA'];
  for (let caso = 0; caso < 35; caso++) {
    const ps = Array.from({ length: 7 }, (_, i) => profissional(`p${i}`, { precoCentavos: Math.floor(aleatorio() * 900), papeis: papeis.filter(() => aleatorio() > 0.4) }));
    const validos = ps.filter(p => p.papeis.length);
    const p = projeto({ orcamentoCentavos: Math.floor(aleatorio() * 1800), papeis: papeis.map(papel => ({ papel, peso: 1, competencias: [] })) });
    let maximo = 0;
    const buscar = (indice: number, usados: Set<string>, custo: number, quantidade: number): void => {
      if (custo > p.orcamentoCentavos) return;
      if (indice === papeis.length) { maximo = Math.max(maximo, quantidade); return; }
      buscar(indice + 1, usados, custo, quantidade);
      for (const profissional of validos) if (!usados.has(profissional.id) && profissional.papeis.includes(papeis[indice]!)) buscar(indice + 1, new Set([...usados, profissional.id]), custo + profissional.precoCentavos, quantidade + 1);
    };
    buscar(0, new Set(), 0, 0);
    const resultado = orquestrador.orquestrar(p, validos);
    assert.equal(resultado.equipe.membros.length, maximo, `caso ${caso}`);
    assert.ok(resultado.equipe.custoCentavos <= p.orcamentoCentavos);
  }
});
