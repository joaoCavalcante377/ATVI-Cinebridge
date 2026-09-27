import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { criarDataSource, RepositorioPostgres } from '../../src/infrastructure/database.ts';
import { EventoEntity } from '../../src/infrastructure/entities.ts';
import { nomeTabela } from '../../src/infrastructure/migration.ts';
import type { EstadoProjeto, Evento, ProfissionalDados } from '../../src/domain/types.ts';
import { PARAMETROS_PADRAO } from '../../src/domain/types.ts';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('Os testes de integração exigem TEST_DATABASE_URL apontando para um PostgreSQL de testes.');
const schema = `teste_${randomUUID().replaceAll('-', '')}`;
const db = criarDataSource(url);
db.setOptions({ schema });
const repo = new RepositorioPostgres(db);
const tabela = (nome: string) => nomeTabela(schema, nome);

function profissional(id = 'p1'): ProfissionalDados {
  return { id, nome: 'Ana', email: `${id}@example.test`, papeis: ['DIRETOR'],
    competencias: [{ nome: 'direcao', nivel: 4 }, { nome: 'roteiro', nivel: 3 }], precoCentavos: 10000,
    disponibilidade: { inicio: '2026-01-01', fim: '2027-12-31' }, localizacao: 'Recife',
    historico: [{ genero: 'drama', tipoCaptacao: 'ficcao', papel: 'DIRETOR' }],
    avaliacoes: [{ nota: 5, comentario: 'Boa entrega', data: '2026-01-01' }, { nota: 4, comentario: 'Boa comunicação', data: '2026-02-01' }],
  };
}
function estado(id = 'projeto1'): EstadoProjeto {
  return {
    projeto: { id, titulo: 'Filme', genero: 'drama', duracaoMinutos: 20, orcamentoCentavos: 50000,
      inicio: '2026-10-01', prazo: '2026-11-01', tipoCaptacao: 'ficcao', localizacao: 'Recife',
      papeis: [{ papel: 'DIRETOR', peso: 1, competencias: [{ nome: 'direcao', nivel: 4 }] }],
      estrategia: 'cosseno', parametros: PARAMETROS_PADRAO },
    equipe: { id: `equipe-${id}`, projetoId: id, membros: [{ papel: 'DIRETOR', profissionalId: 'p1',
      precoCentavos: 10000, pontuacao: 0.8, aceitoProdutor: false, confirmado: false }],
      papeisPendentes: [], custoCentavos: 10000, status: 'SUGERIDA' },
    recomendacao: { id: `rec-${id}`, projetoId: id, estrategia: 'cosseno', candidatos: { DIRETOR: [{
      profissionalId: 'p1', nome: 'Ana', precoCentavos: 10000, pontuacao: 0.8, motivos: ['Competências compatíveis'],
    }] }, degradada: false, avisos: [], criadaEm: '2026-09-23T00:00:00.000Z' },
    convites: [], excluidos: {}, versao: 1,
  };
}
function evento(id: string = randomUUID()): Evento {
  return { id, tipo: 'EquipeRecomendada', projetoId: 'projeto1', ocorridoEm: new Date().toISOString(), dados: { equipeId: 'equipe-projeto1' } };
}
async function criar(eventos: Evento[] = []): Promise<EstadoProjeto> {
  await repo.salvarProfissional(profissional());
  return repo.criarEstado({ estado: estado(), eventos });
}

describe('PostgreSQL real: transações, integridade e outbox', { concurrency: false }, () => {
  before(async () => {
    await db.initialize();
    await db.query(`CREATE SCHEMA "${schema}"`);
    await db.runMigrations({ transaction: 'all' });
  });
  after(async () => {
    if (db.isInitialized) {
      // Only the randomly generated test schema is removed, never public or a database.
      assert.match(schema, /^teste_[a-f0-9]{32}$/);
      await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await db.destroy();
    }
  });
  beforeEach(async () => {
    await db.query(`TRUNCATE ${['auditoria', 'notificacoes', 'outbox_eventos', 'convites', 'recomendacoes', 'membros_equipe', 'equipes', 'projetos', 'avaliacoes', 'competencias', 'profissionais'].map(tabela).join(', ')}`);
  });

  it('aplica migração uma vez e verifica a conexão', async () => {
    assert.deepEqual(await db.runMigrations(), []);
    await repo.verificar();
    assert.equal(await repo.buscarEstado('ausente'), null);
    assert.deepEqual(await repo.statusEventos(), { pendentes: 0, falhos: 0 });
  });

  it('carrega competências e avaliações sem multiplicar linhas e substitui cadastros', async () => {
    const p1 = profissional();
    await repo.salvarProfissional(p1);
    await repo.salvarProfissional({ ...profissional('p2'), competencias: [], avaliacoes: [] });
    const lista = await repo.listarProfissionais();
    assert.equal(lista.length, 2);
    assert.deepEqual(lista[0], p1);
    assert.deepEqual(lista[1]?.competencias, []);
    await repo.salvarProfissional({ ...p1, nome: 'Ana Silva', competencias: [], avaliacoes: [] });
    assert.equal((await repo.listarProfissionais())[0]?.nome, 'Ana Silva');
    assert.equal(await db.getRepository('CompetenciaRegistro').count(), 0);
    assert.equal(await db.getRepository('AvaliacaoRegistro').count(), 0);
  });

  it('reverte todo cadastro quando uma competência viola integridade', async () => {
    await assert.rejects(repo.salvarProfissional({ ...profissional(), competencias: [{ nome: 'x', nivel: 99 }] }));
    assert.deepEqual(await repo.listarProfissionais(), []);
  });

  it('persiste estado relacional e evento atomicamente', async () => {
    const esperado = await criar([evento('evt1')]);
    assert.deepEqual(await repo.buscarEstado('projeto1'), esperado);
    assert.deepEqual(await repo.statusEventos(), { pendentes: 1, falhos: 0 });
    await assert.rejects(repo.criarEstado({ estado: estado(), eventos: [] }));
    assert.equal((await repo.buscarEstado('projeto1'))?.versao, 1);
    await assert.rejects(repo.criarEstado({ estado: estado('outro'), eventos: [evento('duplicado')] }), /outro projeto/);
    assert.equal(await repo.buscarEstado('outro'), null);
  });

  it('mantém o histórico de recomendações, convites encerrados e composição atual', async () => {
    await criar();
    await repo.alterarEstado('projeto1', async atual => {
      atual.convites.push({ id: 'c1', projetoId: 'projeto1', profissionalId: 'p1', papel: 'DIRETOR', status: 'PENDENTE', criadoEm: '2026-09-23T01:00:00Z' });
      return { estado: atual, eventos: [] };
    });
    const mudado = await repo.alterarEstado('projeto1', async atual => {
      atual.recomendacao = { ...atual.recomendacao, id: 'rec-nova', estrategia: 'orcamento' };
      atual.convites[0]!.status = 'CANCELADO';
      atual.convites.push({ ...atual.convites[0]!, id: 'c2', status: 'ACEITO', criadoEm: '2026-09-23T02:00:00Z' });
      atual.equipe.membros[0]!.aceitoProdutor = true;
      atual.equipe.membros[0]!.confirmado = true;
      atual.equipe.status = 'CONFIRMADA';
      atual.excluidos = { DIRETOR: ['p2'] };
      return { estado: atual, eventos: [evento()] };
    });
    assert.equal(mudado.versao, 3);
    assert.deepEqual(await repo.buscarEstado('projeto1'), mudado);
    assert.equal(await db.getRepository('RecomendacaoRegistro').count(), 2);
  });

  it('serializa alterações concorrentes sem perder versões ou confirmar duas vezes', async () => {
    await criar();
    let confirmacoes = 0;
    const alterar = () => repo.alterarEstado('projeto1', async atual => {
      if (!atual.equipe.membros[0]!.confirmado) {
        confirmacoes++;
        atual.equipe.membros[0]!.confirmado = true;
      }
      atual.projeto.duracaoMinutos++;
      await new Promise(resolve => setTimeout(resolve, 10));
      return { estado: atual, eventos: [] };
    });
    await Promise.all([alterar(), alterar(), alterar()]);
    const resultado = await repo.buscarEstado('projeto1');
    assert.equal(confirmacoes, 1);
    assert.equal(resultado?.versao, 4);
    assert.equal(resultado?.projeto.duracaoMinutos, 23);
  });

  it('reverte falhas de callback, IDs alterados e violações de FK', async () => {
    await criar();
    await assert.rejects(repo.alterarEstado('ausente', async atual => ({ estado: atual, eventos: [] })), /não encontrado/);
    await assert.rejects(repo.alterarEstado('projeto1', async atual => {
      atual.projeto.titulo = 'Não persistir';
      throw new Error('Falha antes do commit');
    }), /Falha antes/);
    await assert.rejects(repo.alterarEstado('projeto1', async atual => {
      atual.projeto.id = 'outro';
      return { estado: atual, eventos: [] };
    }), /identificador/);
    await assert.rejects(repo.alterarEstado('projeto1', async atual => {
      atual.equipe.membros[0]!.profissionalId = 'inexistente';
      return { estado: atual, eventos: [evento()] };
    }));
    assert.equal((await repo.buscarEstado('projeto1'))?.projeto.titulo, 'Filme');
    assert.equal((await repo.buscarEstado('projeto1'))?.versao, 1);
    assert.deepEqual(await repo.statusEventos(), { pendentes: 0, falhos: 0 });
  });

  it('suporta equipe parcial sem membros', async () => {
    const parcial = estado();
    parcial.equipe.membros = [];
    parcial.equipe.papeisPendentes = ['DIRETOR'];
    parcial.equipe.custoCentavos = 0;
    parcial.equipe.status = 'PARCIAL';
    await repo.criarEstado({ estado: parcial, eventos: [] });
    assert.deepEqual((await repo.buscarEstado('projeto1'))?.equipe, parcial.equipe);
  });

  it('entrega eventos confirmados, salva efeitos idempotentes e não bloqueia FKs', { timeout: 10_000 }, async () => {
    await criar([evento('evt1')]);
    assert.equal(await repo.entregarPendentes(async evt => {
      const notificacao = { id: `${evt.id}:interno`, eventoId: evt.id, canal: 'interno' as const,
        destinatario: 'produtor', assunto: 'Equipe criada', dados: evt.dados, criadaEm: evt.ocorridoEm };
      const auditoria = { id: `${evt.id}:auditoria`, eventoId: evt.id, evento: evt, criadaEm: evt.ocorridoEm };
      await repo.salvarNotificacao(notificacao);
      await repo.salvarNotificacao(notificacao);
      await repo.salvarAuditoria(auditoria);
      await repo.salvarAuditoria(auditoria);
      return { sucesso: true, falhas: [] };
    }), 1);
    assert.equal((await repo.listarNotificacoes('projeto1')).length, 1);
    assert.equal((await repo.listarAuditoria('projeto1')).length, 1);
    assert.deepEqual(await repo.listarNotificacoes('ausente'), []);
    assert.deepEqual(await repo.listarAuditoria('ausente'), []);
    assert.deepEqual(await repo.statusEventos(), { pendentes: 0, falhos: 0 });
    assert.equal(await repo.entregarPendentes(async () => { throw new Error('Não deve chamar'); }), 0);
  });

  it('reagenda falhas, captura rejeições e para após cinco tentativas', async () => {
    await criar([evento('evt1')]);
    for (let i = 0; i < 5; i++) {
      await db.getRepository(EventoEntity).update({ id: 'evt1' }, { disponivelEm: new Date(0) });
      assert.equal(await repo.entregarPendentes(async () => {
        if (i === 0) throw new Error('SMTP indisponível');
        if (i === 1) throw 'Falha sem objeto Error';
        return { sucesso: false, falhas: ['Serviço indisponível'] };
      }), 1);
      assert.equal(await repo.entregarPendentes(async () => ({ sucesso: true, falhas: [] })), 0);
    }
    assert.deepEqual(await repo.statusEventos(), { pendentes: 0, falhos: 1 });
    const registro = await db.getRepository(EventoEntity).findOneByOrFail({ id: 'evt1' });
    assert.equal(registro.tentativas, 5);
    assert.equal(registro.ultimoErro, 'Serviço indisponível');
  });

  it('recupera falha transitória em tentativa posterior', async () => {
    await criar([evento('evt1')]);
    await repo.entregarPendentes(async () => ({ sucesso: false, falhas: ['indisponível'] }));
    await db.getRepository(EventoEntity).update({ id: 'evt1' }, { disponivelEm: new Date(0) });
    await repo.entregarPendentes(async () => ({ sucesso: true, falhas: [] }));
    assert.equal((await db.getRepository(EventoEntity).findOneByOrFail({ id: 'evt1' })).ultimoErro, null);
  });

  it('distribui a outbox entre workers concorrentes com SKIP LOCKED', async () => {
    await criar([evento('a'), evento('b'), evento('c')]);
    const entregas: string[] = [];
    const entregar = async (evt: Evento) => {
      entregas.push(evt.id);
      await new Promise(resolve => setTimeout(resolve, 20));
      return { sucesso: true, falhas: [] };
    };
    const contagens = await Promise.all([repo.entregarPendentes(entregar, 2), repo.entregarPendentes(entregar, 2)]);
    assert.equal(contagens.reduce((a, b) => a + b, 0), 3);
    assert.deepEqual(entregas.sort(), ['a', 'b', 'c']);
  });

  it('nunca publica eventos ainda não confirmados pela transação', async () => {
    await criar();
    await db.transaction(async manager => {
      await manager.query(`INSERT INTO ${tabela('outbox_eventos')} (id, tipo, "projetoId", "ocorridoEm", dados, status, tentativas, "disponivelEm")
        VALUES ('nao-confirmado', 'Teste', 'projeto1', $1, '{}', 'PENDENTE', 0, now())`, [new Date().toISOString()]);
      assert.equal(await repo.entregarPendentes(async () => { throw new Error('Evento não confirmado'); }), 0);
    });
    assert.equal(await repo.entregarPendentes(async () => ({ sucesso: true, falhas: [] })), 1);
  });
});
