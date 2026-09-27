import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CatalogoProfissionais } from '../src/application/catalog.ts';
import { ServicoEquipes } from '../src/application/service.ts';
import { AuditoriaRecomendacao, NotificadorEmail, NotificadorInterno } from '../src/application/observers.ts';
import { BusEventos } from '../src/infrastructure/event-bus.ts';
import { RepositorioMemoria, projeto } from './support.ts';

function preparar() {
  const repositorio = new RepositorioMemoria();
  const catalogo = new CatalogoProfissionais(() => repositorio.listarProfissionais());
  return { repositorio, catalogo, servico: new ServicoEquipes(repositorio, catalogo) };
}

test('cria recomendação persistida com parâmetros padrão e evento na mesma transação', async () => {
  const { servico, repositorio } = preparar();
  const estado = await servico.criar(projeto({ parametros: { limiteCandidatos: 3 } }));
  assert.equal(estado.equipe.status, 'SUGERIDA');
  assert.equal(estado.equipe.membros.length, 2);
  assert.equal(estado.projeto.parametros.limiteCandidatos, 3);
  assert.equal(estado.projeto.parametros.pesoCompetencia, 0.65);
  assert.equal(estado.recomendacao.degradada, false);
  assert.equal(repositorio.eventos[0]?.tipo, 'recomendacao.gerada');
  assert.deepEqual(await servico.buscar(estado.projeto.id), estado);
  await assert.rejects(servico.buscar('desconhecido'), { status: 404 });
});

test('aceite e respostas confirmam a equipe e emitem um único evento de integração', async () => {
  const { servico, repositorio } = preparar();
  const inicial = await servico.criar(projeto());
  let estado = await servico.aceitar(inicial.projeto.id);
  assert.equal(estado.equipe.status, 'AGUARDANDO');
  assert.equal(estado.convites.length, 2);
  for (const convite of estado.convites) estado = await servico.responder(estado.projeto.id, convite.id, convite.profissionalId, 'ACEITO');
  assert.equal(estado.equipe.status, 'CONFIRMADA');
  assert.ok(estado.equipe.membros.every((m) => m.confirmado && m.aceitoProdutor));
  const eventosAntes = repositorio.eventos.length;
  const convite = estado.convites[0]!;
  await servico.responder(estado.projeto.id, convite.id, convite.profissionalId, 'ACEITO');
  await servico.aceitar(estado.projeto.id);
  assert.equal(repositorio.eventos.length, eventosAntes);
  assert.equal(repositorio.eventos.filter((e) => e.tipo === 'equipe.confirmada').length, 1);
  assert.deepEqual(repositorio.eventos.find((e) => e.tipo === 'equipe.confirmada')?.dados.integracoes, ['gerenciamento_projetos', 'financeiro']);
  await assert.rejects(servico.responder(estado.projeto.id, convite.id, convite.profissionalId, 'RECUSADO'), { status: 409 });
});

test('aceites concorrentes não criam convites duplicados nem perdem alterações', async () => {
  const { servico } = preparar();
  const inicial = await servico.criar(projeto());
  await Promise.all([servico.aceitar(inicial.projeto.id, ['DIRETOR']), servico.aceitar(inicial.projeto.id, ['EDITOR']), servico.aceitar(inicial.projeto.id, ['DIRETOR'])]);
  const estado = await servico.buscar(inicial.projeto.id);
  assert.equal(estado.convites.length, 2);
  assert.equal(estado.equipe.membros.filter((m) => m.aceitoProdutor).length, 2);
});

test('substituição automática preserva escolha e confirmação dos outros papéis', async () => {
  const { servico, repositorio } = preparar();
  const inicial = await servico.criar(projeto());
  let estado = await servico.aceitar(inicial.projeto.id);
  for (const convite of estado.convites) estado = await servico.responder(estado.projeto.id, convite.id, convite.profissionalId, 'ACEITO');
  const editor = estado.equipe.membros.find((m) => m.papel === 'EDITOR');
  const conviteAntigo = estado.convites.find((c) => c.papel === 'DIRETOR')!;
  const substituida = await servico.substituir(estado.projeto.id, 'DIRETOR');
  assert.deepEqual(substituida.equipe.membros.find((m) => m.papel === 'EDITOR'), editor);
  assert.notEqual(substituida.equipe.membros.find((m) => m.papel === 'DIRETOR')?.profissionalId, conviteAntigo.profissionalId);
  assert.equal(substituida.convites.find((c) => c.id === conviteAntigo.id)?.status, 'CANCELADO');
  assert.equal(substituida.equipe.status, 'AGUARDANDO');
  assert.equal(substituida.equipe.id, inicial.equipe.id);
  assert.ok(repositorio.eventos.some((e) => e.tipo === 'equipe.reaberta'));
  await assert.rejects(servico.responder(estado.projeto.id, conviteAntigo.id, conviteAntigo.profissionalId, 'ACEITO'), { status: 409 });
});

test('substituição manual valida elegibilidade, papel e exclusões antes do commit', async () => {
  const { servico, repositorio } = preparar();
  const inicial = await servico.criar(projeto());
  const diretor = inicial.equipe.membros.find((m) => m.papel === 'DIRETOR')!;
  await assert.rejects(servico.substituir(inicial.projeto.id, 'DIRETOR', diretor.profissionalId), /diferente/);
  await assert.rejects(servico.substituir(inicial.projeto.id, 'SONOPLASTA'), /não exigido/);
  await assert.rejects(servico.substituir(inicial.projeto.id, 'DIRETOR', 'nao-cadastrado'), /não atende/);
  assert.deepEqual(await servico.buscar(inicial.projeto.id), inicial);
  assert.equal(repositorio.eventos.length, 1);
  const novoId = diretor.profissionalId === 'diretor-1' ? 'diretor-2' : 'diretor-1';
  const nova = await servico.substituir(inicial.projeto.id, 'DIRETOR', novoId);
  assert.equal(nova.equipe.membros.find((m) => m.papel === 'DIRETOR')?.profissionalId, novoId);
  await assert.rejects(servico.substituir(inicial.projeto.id, 'DIRETOR', diretor.profissionalId), /não atende/);
});

test('recusa preserva os demais integrantes e recomenda outra pessoa sem convidá-la automaticamente', async () => {
  const { servico, repositorio } = preparar();
  const inicial = await servico.criar(projeto());
  const aceita = await servico.aceitar(inicial.projeto.id);
  const convite = aceita.convites.find((c) => c.papel === 'DIRETOR')!;
  const editor = aceita.equipe.membros.find((m) => m.papel === 'EDITOR');
  const nova = await servico.responder(inicial.projeto.id, convite.id, convite.profissionalId, 'RECUSADO');
  assert.equal(nova.convites.find((c) => c.id === convite.id)?.status, 'RECUSADO');
  assert.notEqual(nova.equipe.membros.find((m) => m.papel === 'DIRETOR')?.profissionalId, convite.profissionalId);
  assert.equal(nova.equipe.membros.find((m) => m.papel === 'DIRETOR')?.aceitoProdutor, false);
  assert.deepEqual(nova.equipe.membros.find((m) => m.papel === 'EDITOR'), editor);
  assert.ok(repositorio.eventos.some((e) => e.tipo === 'convite.respondido' && e.dados.resposta === 'RECUSADO'));
  const quantidade = repositorio.eventos.length;
  await servico.responder(inicial.projeto.id, convite.id, convite.profissionalId, 'RECUSADO');
  assert.equal(repositorio.eventos.length, quantidade);
});

test('recusa sem alternativa mantém equipe parcial e permite aceitar os demais papéis', async () => {
  const { servico, repositorio, catalogo } = preparar();
  repositorio.profissionais = repositorio.profissionais.filter((p) => p.id !== 'diretor-2');
  const inicial = await servico.criar(projeto());
  const aceita = await servico.aceitar(inicial.projeto.id, ['DIRETOR']);
  const convite = aceita.convites[0]!;
  const parcial = await servico.responder(inicial.projeto.id, convite.id, convite.profissionalId, 'RECUSADO');
  assert.equal(parcial.equipe.status, 'PARCIAL');
  assert.deepEqual(parcial.equipe.papeisPendentes, ['DIRETOR']);
  const editor = await servico.aceitar(inicial.projeto.id, ['EDITOR']);
  assert.equal(editor.equipe.status, 'PARCIAL');
  assert.equal(editor.convites.length, 2);
  await assert.rejects(servico.aceitar(inicial.projeto.id, ['DIRETOR']), /não tem profissional/);
  // Agora um novo cadastro pode preencher um papel que ficou vago.
  repositorio.profissionais.push({ ...repositorio.profissionais[0]!, id: 'diretor-novo' });
  catalogo.invalidar();
  const preenchida = await servico.substituir(inicial.projeto.id, 'DIRETOR', 'diretor-novo');
  assert.equal(preenchida.equipe.papeisPendentes.length, 0);
});

test('respostas rejeitam convite inexistente, destinatário diferente e vínculo obsoleto', async () => {
  const { servico, repositorio } = preparar();
  const inicial = await servico.criar(projeto());
  const aceita = await servico.aceitar(inicial.projeto.id);
  const convite = aceita.convites[0]!;
  await assert.rejects(servico.responder(inicial.projeto.id, 'ausente', convite.profissionalId, 'ACEITO'), { status: 404 });
  await assert.rejects(servico.responder(inicial.projeto.id, convite.id, 'outro', 'ACEITO'), { status: 403 });
  const salvo = repositorio.estados.get(inicial.projeto.id)!;
  salvo.equipe.membros = salvo.equipe.membros.filter((m) => m.papel !== convite.papel);
  await assert.rejects(servico.responder(inicial.projeto.id, convite.id, convite.profissionalId, 'ACEITO'), { status: 409 });
});

test('reavaliação cancela convites antigos, atualiza parâmetros e solicita novos aceites', async () => {
  const { servico, repositorio } = preparar();
  const inicial = await servico.criar(projeto());
  let aceita = await servico.aceitar(inicial.projeto.id);
  for (const convite of aceita.convites) aceita = await servico.responder(inicial.projeto.id, convite.id, convite.profissionalId, 'ACEITO');
  const reavaliada = await servico.reavaliar(inicial.projeto.id, { estrategia: 'orcamento', parametros: { limiteCandidatos: 1 } });
  assert.equal(reavaliada.recomendacao.estrategia, 'orcamento');
  assert.equal(reavaliada.projeto.parametros.limiteCandidatos, 1);
  assert.equal(reavaliada.projeto.parametros.pesoCompetencia, inicial.projeto.parametros.pesoCompetencia);
  assert.ok(reavaliada.convites.every((c) => c.status === 'CANCELADO'));
  assert.ok(reavaliada.equipe.membros.every((m) => !m.aceitoProdutor && !m.confirmado));
  assert.equal(reavaliada.equipe.status, 'SUGERIDA');
  assert.ok(repositorio.eventos.some((e) => e.tipo === 'projeto.reavaliado'));
  assert.ok(repositorio.eventos.some((e) => e.tipo === 'equipe.reaberta'));
  const antes = structuredClone(reavaliada);
  await assert.rejects(servico.reavaliar(inicial.projeto.id, { orcamentoCentavos: -1 }), /Orçamento/);
  assert.deepEqual(await servico.buscar(inicial.projeto.id), antes);
});

test('falha no meio de uma alteração ou no commit não publica estado nem eventos parciais', async () => {
  const { servico, repositorio } = preparar();
  const inicial = await servico.criar(projeto());
  await assert.rejects(servico.aceitar(inicial.projeto.id, ['DIRETOR', 'SONOPLASTA']), /não tem profissional/);
  assert.deepEqual(await servico.buscar(inicial.projeto.id), inicial);
  assert.equal(repositorio.eventos.length, 1);
  repositorio.falharCommit = true;
  await assert.rejects(servico.aceitar(inicial.projeto.id), /Commit recusado/);
  await assert.rejects(servico.criar(projeto()), /Commit recusado/);
  assert.deepEqual(await servico.buscar(inicial.projeto.id), inicial);
  assert.equal(repositorio.eventos.length, 1);
  assert.equal(repositorio.estados.size, 1);
});

test('contingência permite sugestão degradada e bloqueia confirmação ou troca manual', async () => {
  const { servico, repositorio, catalogo } = preparar();
  const inicial = await servico.criar(projeto());
  repositorio.falharLeitura = true;
  catalogo.invalidar();
  const degradada = await servico.criar(projeto());
  assert.equal(degradada.recomendacao.degradada, true);
  assert.ok(degradada.recomendacao.avisos.length > 0);
  await assert.rejects(servico.aceitar(inicial.projeto.id), { status: 503 });
  await assert.rejects(servico.substituir(inicial.projeto.id, 'DIRETOR', 'diretor-2'), { status: 503 });
  assert.deepEqual(await servico.buscar(inicial.projeto.id), inicial);
});

test('sem cadastro disponível responde com equipe parcial explícita', async () => {
  const { servico, repositorio } = preparar();
  repositorio.falharLeitura = true;
  const estado = await servico.criar(projeto());
  assert.equal(estado.equipe.status, 'PARCIAL');
  assert.equal(estado.equipe.membros.length, 0);
  assert.equal(estado.recomendacao.degradada, true);
  repositorio.falharLeitura = false;
  await assert.rejects(servico.aceitar(estado.projeto.id, []), /Não há membros/);
});

test('recusa é registrada mesmo sem cache do cadastro, preservando os outros papéis', async () => {
  const repositorio = new RepositorioMemoria();
  const catalogo = new CatalogoProfissionais(() => repositorio.listarProfissionais(), { ttlMs: 0, maxStaleMs: 0 });
  const servico = new ServicoEquipes(repositorio, catalogo);
  const inicial = await servico.criar(projeto());
  const aceita = await servico.aceitar(inicial.projeto.id);
  const convite = aceita.convites[0]!;
  const fixos = aceita.equipe.membros.filter(m => m.papel !== convite.papel);
  repositorio.falharLeitura = true;
  await new Promise(resolve => setTimeout(resolve, 5));
  const recusada = await servico.responder(inicial.projeto.id, convite.id, convite.profissionalId, 'RECUSADO');
  assert.equal(recusada.convites.find(c => c.id === convite.id)?.status, 'RECUSADO');
  assert.equal(recusada.equipe.status, 'PARCIAL');
  assert.deepEqual(recusada.equipe.membros, fixos);
  assert.equal(recusada.recomendacao.degradada, true);
  assert.ok(recusada.recomendacao.avisos.some(a => a.includes('preservadas')));
});

test('eventos persistidos alimentam notificações e auditoria, sem duplicar em reentrega', async () => {
  const { servico, repositorio } = preparar();
  const estado = await servico.criar(projeto());
  await servico.aceitar(estado.projeto.id);
  const bus = new BusEventos();
  bus.assinar(new NotificadorEmail(repositorio));
  bus.assinar(new NotificadorInterno(repositorio));
  bus.assinar(new AuditoriaRecomendacao(repositorio));
  await repositorio.entregarPendentes((evento) => bus.publicar(evento));
  assert.equal((await repositorio.statusEventos()).pendentes, 0);
  assert.equal((await repositorio.listarAuditoria(estado.projeto.id)).length, 3);
  const antes = (await repositorio.listarNotificacoes(estado.projeto.id)).length;
  assert.equal(antes, 10);
  await bus.publicar(repositorio.eventos[0]!);
  assert.equal((await repositorio.listarNotificacoes(estado.projeto.id)).length, antes);
  await bus.fechar();
});
