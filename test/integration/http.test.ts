import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { criarDataSource, RepositorioPostgres } from '../../src/infrastructure/database.ts';
import { criarApp } from '../../src/http/app.ts';
import { profissionaisExemplo, projetoExemplo } from '../../scripts/fixtures.ts';
import type { Auditoria, EstadoProjeto, Notificacao } from '../../src/domain/types.ts';

if (!process.env.TEST_DATABASE_URL) throw new Error('Defina TEST_DATABASE_URL para os testes HTTP com PostgreSQL.');
const schema = `http_${randomUUID().replaceAll('-', '')}`;
const db = criarDataSource(process.env.TEST_DATABASE_URL);
db.setOptions({ schema });
const repo = new RepositorioPostgres(db);
const { app, worker } = criarApp(repo, { logger: false, worker: false });
const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload });

describe('API HTTP com PostgreSQL', () => {
  before(async () => {
    await db.initialize();
    await db.query(`CREATE SCHEMA "${schema}"`);
    await db.runMigrations();
    for (const profissional of profissionaisExemplo()) await repo.salvarProfissional(profissional);
    await app.ready();
  });
  after(async () => {
    await app.close();
    if (db.isInitialized) {
      assert.match(schema, /^http_[a-f0-9]{32}$/);
      await db.query(`DROP SCHEMA "${schema}" CASCADE`);
      await db.destroy();
    }
  });

  it('informa saúde, prontidão e projetos ausentes', async () => {
    assert.equal((await app.inject('/health')).statusCode, 200);
    assert.equal((await app.inject('/ready')).statusCode, 200);
    assert.equal((await app.inject(`/projetos/${randomUUID()}`)).statusCode, 404);
    assert.equal((await app.inject('/projetos/id-invalido')).statusCode, 400);
  });

  it('valida formato, calendário e regras antes de persistir', async () => {
    for (const entrada of [
      { ...projetoExemplo(), campoDesconhecido: true },
      { ...projetoExemplo(), estrategia: 'inexistente' },
      { ...projetoExemplo(), orcamentoCentavos: '600000' },
      { ...projetoExemplo(), prazo: '2027-02-30' },
      { ...projetoExemplo(), inicio: '2027-04-01' },
      { ...projetoExemplo(), papeis: [projetoExemplo().papeis[0], projetoExemplo().papeis[0]] },
    ]) assert.ok([400, 422].includes((await post('/projetos', entrada)).statusCode));
    const { id: _id, ...pessoa } = profissionaisExemplo()[0]!;
    assert.equal((await post('/profissionais', { ...pessoa, email: 'sem-email' })).statusCode, 400);
    assert.equal((await post('/profissionais', { ...pessoa, disponibilidade: { inicio: '2028-01-01', fim: '2027-01-01' } })).statusCode, 422);
    const cadastro = await post('/profissionais', { ...pessoa, nome: 'Nova profissional' });
    assert.equal(cadastro.statusCode, 201, cadastro.body);
    assert.equal(cadastro.json().nome, 'Nova profissional');
  });

  it('troca estratégias, mantém valores monetários grandes e duração fracionária', async () => {
    const equipes: string[] = [];
    for (const estrategia of ['cosseno', 'colaborativa', 'orcamento'] as const) {
      const resposta = await post('/projetos', { ...projetoExemplo(estrategia), duracaoMinutos: 20.5 });
      assert.equal(resposta.statusCode, 201, resposta.body);
      const estado = resposta.json<EstadoProjeto>();
      const leitura = (await app.inject(`/projetos/${estado.projeto.id}`)).json<EstadoProjeto>();
      assert.equal(leitura.projeto.orcamentoCentavos, 600_000);
      assert.equal(leitura.projeto.duracaoMinutos, 20.5);
      equipes.push(estado.equipe.membros.map(m => m.profissionalId).join(','));
    }
    assert.ok(new Set(equipes).size >= 2);
    const grande = (await post('/projetos', { ...projetoExemplo(), orcamentoCentavos: 3_000_000_000 })).json<EstadoProjeto>();
    assert.equal((await app.inject(`/projetos/${grande.projeto.id}`)).json<EstadoProjeto>().projeto.orcamentoCentavos, 3_000_000_000);
  });

  it('recusa, substitui apenas o papel afetado e confirma uma única vez sob concorrência', async () => {
    let estado = (await post('/projetos', projetoExemplo())).json<EstadoProjeto>();
    const id = estado.projeto.id;
    estado = (await post(`/projetos/${id}/aceitar`, {})).json<EstadoProjeto>();
    assert.equal(estado.convites.length, 6);
    const primeiro = estado.convites[0]!;
    const fixos = estado.equipe.membros.filter(m => m.papel !== primeiro.papel);
    const recusa = await post(`/projetos/${id}/convites/${primeiro.id}/resposta`, { profissionalId: primeiro.profissionalId, resposta: 'RECUSADO' });
    assert.equal(recusa.statusCode, 200, recusa.body);
    estado = recusa.json<EstadoProjeto>();
    assert.deepEqual(estado.equipe.membros.filter(m => m.papel !== primeiro.papel), fixos);
    assert.notEqual(estado.equipe.membros.find(m => m.papel === primeiro.papel)?.profissionalId, primeiro.profissionalId);
    estado = (await post(`/projetos/${id}/aceitar`, {})).json<EstadoProjeto>();
    const pendentes = estado.convites.filter(c => c.status === 'PENDENTE');
    const respostas = await Promise.all(pendentes.map(c => post(`/projetos/${id}/convites/${c.id}/resposta`, { profissionalId: c.profissionalId, resposta: 'ACEITO' })));
    assert.ok(respostas.every(r => r.statusCode === 200), respostas.map(r => r.body).join('\n'));
    const ultimo = pendentes.at(-1)!;
    const repetida = await post(`/projetos/${id}/convites/${ultimo.id}/resposta`, { profissionalId: ultimo.profissionalId, resposta: 'ACEITO' });
    assert.equal(repetida.statusCode, 200);
    estado = repetida.json<EstadoProjeto>();
    assert.equal(estado.equipe.status, 'CONFIRMADA');
    await worker.processar();
    const auditoria = (await app.inject(`/projetos/${id}/auditoria`)).json<Auditoria[]>();
    assert.equal(auditoria.filter(a => a.evento.tipo === 'equipe.confirmada').length, 1);
    const notificacoes = (await app.inject(`/projetos/${id}/notificacoes`)).json<Notificacao[]>();
    assert.ok(notificacoes.some(n => n.canal === 'email'));
    assert.ok(notificacoes.some(n => n.canal === 'interno'));
    assert.equal(new Set(notificacoes.map(n => n.id)).size, notificacoes.length);
    const relatorio = (await app.inject(`/projetos/${id}/relatorio`)).json();
    assert.deepEqual(relatorio.inconsistencias, []);
    assert.ok(relatorio.compatibilidade > 0 && relatorio.compatibilidade <= 1);
    assert.match(relatorio.texto, /CONFIRMADA/);
    const reavaliada = await post(`/projetos/${id}/reavaliar`, { orcamentoCentavos: 300_000, estrategia: 'orcamento' });
    assert.equal(reavaliada.statusCode, 200, reavaliada.body);
    assert.ok(reavaliada.json<EstadoProjeto>().equipe.custoCentavos <= 300_000);
    assert.equal((await post(`/projetos/${id}/convites/${ultimo.id}/resposta`, { profissionalId: ultimo.profissionalId, resposta: 'ACEITO' })).statusCode, 409);
  });

  it('substituição manual inválida reverte a transação; substituição automática funciona', async () => {
    const estado = (await post('/projetos', projetoExemplo())).json<EstadoProjeto>();
    const url = `/projetos/${estado.projeto.id}`;
    const falha = await post(`${url}/membros/DIRETOR/substituir`, { profissionalId: randomUUID() });
    assert.equal(falha.statusCode, 422, falha.body);
    assert.deepEqual((await app.inject(url)).json(), estado);
    const sucesso = await post(`${url}/membros/DIRETOR/substituir`, {});
    assert.equal(sucesso.statusCode, 200, sucesso.body);
    const antes = estado.equipe.membros.find(m => m.papel === 'DIRETOR')!;
    assert.notEqual(sucesso.json<EstadoProjeto>().equipe.membros.find(m => m.papel === 'DIRETOR')?.profissionalId, antes.profissionalId);
  });
});
