import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as esperar } from 'node:timers/promises';
import { ProcessadorEventos } from '../src/infrastructure/worker.ts';
import { BusEventos } from '../src/infrastructure/event-bus.ts';
import { RepositorioMemoria } from './support.ts';

test('worker compartilha processamento concorrente e drena antes de encerrar', async () => {
  const repo = new RepositorioMemoria();
  let chamadas = 0;
  repo.entregarPendentes = async () => { chamadas++; await esperar(5); return 3; };
  const worker = new ProcessadorEventos(repo, new BusEventos());
  const a = worker.processar(), b = worker.processar();
  assert.equal(a, b);
  await worker.fechar();
  assert.equal(await a, 3);
  assert.equal(chamadas, 1);
});

test('falha periódica é observada e a próxima rodada pode recuperar', async () => {
  const repo = new RepositorioMemoria();
  let chamadas = 0, falhas = 0;
  repo.entregarPendentes = async () => { if (++chamadas === 1) throw new Error('offline'); return 0; };
  const worker = new ProcessadorEventos(repo, new BusEventos(), () => { falhas++; });
  worker.iniciar(2); worker.iniciar(2);
  await esperar(30);
  await worker.fechar();
  assert.equal(falhas, 1);
  assert.ok(chamadas >= 2);
});

test('encerramento fecha barramento mesmo quando a persistência falha', async () => {
  const repo = new RepositorioMemoria();
  repo.entregarPendentes = async () => { await esperar(5); throw new Error('offline'); };
  const bus = new BusEventos();
  const worker = new ProcessadorEventos(repo, bus);
  const processo = worker.processar();
  await assert.rejects(worker.fechar(), /offline/);
  await assert.rejects(processo, /offline/);
  assert.throws(() => bus.assinar({ nome: 'tarde', atualizar: () => {} }), /encerrado/);
});

test('erro no logger do worker não se torna rejeição não tratada', async () => {
  const repo = new RepositorioMemoria();
  repo.entregarPendentes = async () => { throw new Error('offline'); };
  const worker = new ProcessadorEventos(repo, new BusEventos(), () => { throw new Error('logger offline'); });
  worker.iniciar(2);
  await esperar(12);
  await worker.fechar();
});
