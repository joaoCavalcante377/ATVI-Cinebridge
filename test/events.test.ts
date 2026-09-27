import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as esperar } from 'node:timers/promises';
import { BusEventos } from '../src/infrastructure/event-bus.ts';
import { AuditoriaRecomendacao, NotificadorEmail, NotificadorInterno } from '../src/application/observers.ts';
import type { Auditoria, Evento, Notificacao } from '../src/domain/types.ts';

const evento: Evento = {
  id: 'evento-1', tipo: 'equipe.confirmada', projetoId: 'projeto-1',
  ocorridoEm: '2026-09-23T12:00:00.000Z', dados: { destinatarios: ['profissional-1', 'produtor:projeto-1'] },
};

test('publicação aguarda listeners assíncronos e permite execução independente', async () => {
  const bus = new BusEventos();
  const passos: string[] = [];
  let liberar!: () => void;
  const bloqueio = new Promise<void>((resolve) => { liberar = resolve; });
  bus.assinar({ nome: 'lento', atualizar: async () => { passos.push('inicio'); await bloqueio; passos.push('fim'); } });
  bus.assinar({ nome: 'rapido', atualizar: () => { passos.push('rapido'); liberar(); } });
  assert.deepEqual(await bus.publicar(evento), { sucesso: true, falhas: [] });
  assert.deepEqual(passos, ['inicio', 'rapido', 'fim']);
  await bus.fechar();
});

test('throws e rejeições são isolados; apenas o observador que falha é repetido', async () => {
  const erros: string[] = [];
  const bus = new BusEventos({ tentativas: 2, onError: (falha) => { erros.push(falha.observador); } });
  let chamadasSucesso = 0;
  let chamadasRecuperavel = 0;
  bus.assinar({ nome: 'sucesso', atualizar: () => { chamadasSucesso++; } });
  bus.assinar({ nome: 'recuperavel', atualizar: () => { if (++chamadasRecuperavel === 1) throw new Error('temporário'); } });
  bus.assinar({ nome: 'rejeicao', atualizar: async () => { throw new Error('permanente'); } });
  assert.deepEqual(await bus.publicar(evento), { sucesso: false, falhas: ['rejeicao'] });
  assert.equal(chamadasSucesso, 1);
  assert.equal(chamadasRecuperavel, 2);
  assert.equal(erros.filter((nome) => nome === 'rejeicao').length, 2);
  await bus.publicar(evento);
  assert.equal(chamadasSucesso, 1);
  assert.equal(chamadasRecuperavel, 2);
  await bus.fechar();
});

test('falha do callback de observabilidade não interrompe os observadores', async () => {
  for (const onError of [() => { throw new Error('logger indisponível'); }, async () => { throw new Error('logger indisponível'); }]) {
    const bus = new BusEventos({ tentativas: 1, onError });
    bus.assinar({ nome: 'falho', atualizar: () => { throw new Error('erro do observador'); } });
    assert.deepEqual(await bus.publicar(evento), { sucesso: false, falhas: ['falho'] });
    await bus.fechar();
  }
});

test('timeout aborta sinal cooperativo e não bloqueia observadores saudáveis', async () => {
  const bus = new BusEventos({ timeoutMs: 10, tentativas: 1 });
  let abortado = false;
  let entregue = false;
  bus.assinar({ nome: 'travado', atualizar: (_, signal) => new Promise<void>((_, reject) => {
    signal.addEventListener('abort', () => { abortado = true; reject(signal.reason); }, { once: true });
  }) });
  bus.assinar({ nome: 'saudavel', atualizar: () => { entregue = true; } });
  assert.deepEqual(await bus.publicar(evento), { sucesso: false, falhas: ['travado'] });
  assert.equal(abortado, true);
  assert.equal(entregue, true);
  await bus.fechar();
});

test('rejeição tardia depois de timeout é observada', async () => {
  const bus = new BusEventos({ timeoutMs: 5, tentativas: 1 });
  let rejeitou = false;
  bus.assinar({ nome: 'ignora-abort', atualizar: async () => {
    await esperar(20); rejeitou = true; throw new Error('resposta tardia');
  } });
  assert.equal((await bus.publicar(evento)).sucesso, false);
  await esperar(30);
  assert.equal(rejeitou, true);
  await bus.fechar();
});

test('publicações concorrentes do mesmo evento compartilham a entrega', async () => {
  const bus = new BusEventos();
  let chamadas = 0;
  bus.assinar({ nome: 'contador', atualizar: async () => { chamadas++; await esperar(5); } });
  const primeira = bus.publicar(evento);
  assert.equal(bus.publicar(evento), primeira);
  assert.equal((await primeira).sucesso, true);
  assert.equal(chamadas, 1);
  await bus.fechar();
});

test('cache tem tamanho limitado e eventos expulsos podem ser reentregues', async () => {
  const bus = new BusEventos({ cacheMaximo: 1 });
  let chamadas = 0;
  bus.assinar({ nome: 'contador', atualizar: () => { chamadas++; } });
  await bus.publicar(evento);
  await bus.publicar({ ...evento, id: 'evento-2' });
  await bus.publicar(evento);
  assert.equal(chamadas, 3);
  await bus.fechar();
});

test('registro durável evita repetir observador após reinício do barramento', async () => {
  const registros = new Set<string>();
  const entregas = {
    async foiEntregue(eventoId: string, nome: string) { return registros.has(`${eventoId}/${nome}`); },
    async registrarEntrega(eventoId: string, nome: string) { registros.add(`${eventoId}/${nome}`); },
  };
  let chamadas = 0;
  for (let i = 0; i < 2; i++) {
    const bus = new BusEventos({ entregas });
    bus.assinar({ nome: 'contador', atualizar: () => { chamadas++; } });
    assert.equal((await bus.publicar(evento)).sucesso, true);
    await bus.fechar();
  }
  assert.equal(chamadas, 1);
});

test('erro do registro durável é relatado sem marcar a publicação como entregue', async () => {
  const bus = new BusEventos({ tentativas: 1, entregas: {
    async foiEntregue() { throw new Error('banco fora do ar'); },
    async registrarEntrega() {},
  } });
  let chamadas = 0;
  bus.assinar({ nome: 'contador', atualizar: () => { chamadas++; } });
  assert.deepEqual(await bus.publicar(evento), { sucesso: false, falhas: ['contador'] });
  assert.equal(chamadas, 0);
  await bus.fechar();
});

test('consulta travada no registro durável também respeita prazo de encerramento', async () => {
  const bus = new BusEventos({ timeoutMs: 5, tentativas: 1, entregas: {
    async foiEntregue() { return await new Promise<boolean>(() => {}); },
    async registrarEntrega() {},
  } });
  bus.assinar({ nome: 'contador', atualizar() { assert.fail('registro não foi consultado'); } });
  const pendente = bus.publicar(evento);
  await bus.fechar();
  assert.deepEqual(await pendente, { sucesso: false, falhas: ['contador'] });
});

test('encerramento drena publicações aceitas e rejeita novas operações', async () => {
  const bus = new BusEventos();
  let entregue = false;
  bus.assinar({ nome: 'pendente', atualizar: async () => { await esperar(10); entregue = true; } });
  const publicacao = bus.publicar(evento);
  await bus.fechar();
  assert.equal(entregue, true);
  assert.equal((await publicacao).sucesso, true);
  await assert.rejects(bus.publicar(evento), /encerrado/);
  assert.throws(() => bus.assinar({ nome: 'novo', atualizar() {} }), /encerrado/);
  await bus.fechar();
});

test('validar configuração e inscrições evita ambiguidade de observadores', async () => {
  for (const config of [{ timeoutMs: 0 }, { tentativas: -1 }, { cacheMaximo: 1.5 }]) {
    assert.throws(() => new BusEventos(config), /inteiro positivo/);
  }
  const bus = new BusEventos();
  assert.throws(() => bus.assinar({ nome: ' ', atualizar() {} }), /nome único/);
  let chamadas = 0;
  const cancelar = bus.assinar({ nome: 'contador', atualizar() { chamadas++; } });
  assert.throws(() => bus.assinar({ nome: 'contador', atualizar() {} }), /nome único/);
  cancelar();
  const cancelarNovo = bus.assinar({ nome: 'contador', atualizar() { chamadas++; } });
  cancelar();
  assert.equal((await bus.publicar(evento)).sucesso, true);
  assert.equal(chamadas, 1);
  cancelarNovo();
  assert.equal((await bus.publicar({ ...evento, id: 'sem-observador' })).sucesso, true);
  await bus.fechar();
});

test('notificações e auditoria têm IDs estáveis e destinos independentes', async () => {
  const notificacoes = new Map<string, Notificacao>();
  const auditorias = new Map<string, Auditoria>();
  const sink = {
    async salvarNotificacao(notificacao: Notificacao) { notificacoes.set(notificacao.id, notificacao); },
    async salvarAuditoria(auditoria: Auditoria) { auditorias.set(auditoria.id, auditoria); },
  };
  // Simula reinício: cache vazio, mas upsert por ID preserva uma linha por entrega.
  for (let i = 0; i < 2; i++) {
    const bus = new BusEventos();
    bus.assinar(new NotificadorEmail(sink));
    bus.assinar(new NotificadorInterno(sink));
    bus.assinar(new AuditoriaRecomendacao(sink));
    assert.equal((await bus.publicar(evento)).sucesso, true);
    await bus.fechar();
  }
  assert.equal(notificacoes.size, 4);
  assert.equal(auditorias.size, 1);
  const canais = [...notificacoes.values()].map((n) => n.canal);
  assert.equal(canais.filter((canal) => canal === 'email').length, 2);
  assert.equal(canais.filter((canal) => canal === 'interno').length, 2);
  assert.deepEqual(auditorias.values().next().value?.evento, evento);
  assert.notEqual(auditorias.values().next().value?.evento, evento);
});

test('notificadores ignoram destinatários inválidos e não duplicam o mesmo destino', async () => {
  const linhas: Notificacao[] = [];
  const sink = { async salvarNotificacao(n: Notificacao) { linhas.push(n); } };
  const notificador = new NotificadorEmail(sink);
  const signal = new AbortController().signal;
  await notificador.atualizar({ ...evento, dados: {} }, signal);
  await notificador.atualizar({ ...evento, dados: { destinatarios: ['a', 'a', 3, null, '', 'b'] } }, signal);
  assert.deepEqual(linhas.map((n) => n.destinatario), ['a', 'b']);
});

test('observadores respeitam cancelamento e falhas de persistência', async () => {
  const controller = new AbortController();
  let chamadas = 0;
  const sink = {
    async salvarNotificacao() { chamadas++; controller.abort(new Error('cancelado')); },
    async salvarAuditoria() { chamadas++; },
  };
  await assert.rejects(new NotificadorInterno(sink).atualizar(evento, controller.signal), /cancelado/);
  assert.equal(chamadas, 1);
  await assert.rejects(new NotificadorEmail(sink).atualizar(evento, controller.signal), /cancelado/);
  await assert.rejects(new AuditoriaRecomendacao(sink).atualizar(evento, controller.signal), /cancelado/);
  await assert.rejects(new NotificadorEmail({ async salvarNotificacao() { throw new Error('banco'); } })
    .atualizar(evento, new AbortController().signal), /banco/);
});
