import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as esperar } from 'node:timers/promises';
import { CatalogoProfissionais } from '../src/application/catalog.ts';
import { profissional } from './support.ts';
import type { ProfissionalDados } from '../src/domain/types.ts';

test('cache fresco e leituras concorrentes compartilham a consulta', async () => {
  let chamadas = 0;
  const catalogo = new CatalogoProfissionais(async () => { chamadas++; await esperar(5); return [profissional()]; });
  const [a, b] = await Promise.all([catalogo.consultar(), catalogo.consultar()]);
  assert.equal(a.degradada, false);
  assert.deepEqual(a, b);
  await catalogo.consultar();
  assert.equal(chamadas, 1);
  catalogo.invalidar();
  await catalogo.consultar();
  assert.equal(chamadas, 2);
});

test('cache expirado tem prazo próprio de contingência, preservado na invalidação', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  let falhar = false;
  const catalogo = new CatalogoProfissionais(async () => { if (falhar) throw new Error('fora'); return [profissional()]; }, { ttlMs: 100, maxStaleMs: 500 });
  await catalogo.consultar();
  t.mock.timers.tick(110);
  falhar = true;
  const contingencia = await catalogo.consultar();
  assert.equal(contingencia.degradada, true);
  assert.equal(contingencia.profissionais.length, 1);
  assert.match(contingencia.avisos[0]!, /última leitura/);
  catalogo.invalidar();
  assert.equal((await catalogo.consultar()).profissionais.length, 1);
  t.mock.timers.tick(500);
  const expirada = await catalogo.consultar();
  assert.deepEqual(expirada.profissionais, []);
  assert.match(expirada.avisos[0]!, /sem cache válido/);
});

test('consulta nova após invalidação não recebe nem armazena snapshot anterior', async () => {
  let completarAntiga!: (dados: ProfissionalDados[]) => void;
  let chamadas = 0;
  const catalogo = new CatalogoProfissionais(async () => {
    if (++chamadas === 1) return new Promise<ProfissionalDados[]>((resolve) => { completarAntiga = resolve; });
    return [profissional('novo')];
  });
  const antiga = catalogo.consultar();
  await Promise.resolve();
  catalogo.invalidar();
  const nova = await catalogo.consultar();
  completarAntiga([profissional('antigo')]);
  assert.equal(nova.profissionais[0]?.id, 'novo');
  assert.equal((await antiga).profissionais[0]?.id, 'novo');
  assert.equal((await catalogo.consultar()).profissionais[0]?.id, 'novo');
  assert.equal(chamadas, 2);
});

test('timeout retorna contingência e permite uma nova tentativa mesmo com leitura travada', async () => {
  let chamadas = 0;
  const catalogo = new CatalogoProfissionais(async () => {
    if (++chamadas === 1) return new Promise<ProfissionalDados[]>(() => {});
    return [profissional()];
  }, { timeoutMs: 5 });
  assert.equal((await catalogo.consultar()).degradada, true);
  assert.equal((await catalogo.consultar()).degradada, false);
  assert.equal(chamadas, 2);
});

test('leitura que terminou depois do timeout não sobrescreve uma leitura mais recente', async () => {
  let completarAntiga!: (dados: ProfissionalDados[]) => void;
  let chamadas = 0;
  const catalogo = new CatalogoProfissionais(async () => {
    if (++chamadas === 1) return new Promise<ProfissionalDados[]>((resolve) => { completarAntiga = resolve; });
    return [profissional('novo')];
  }, { timeoutMs: 5 });
  await catalogo.consultar();
  await catalogo.consultar();
  completarAntiga([profissional('antigo')]);
  await esperar(0);
  assert.equal((await catalogo.consultar()).profissionais[0]?.id, 'novo');
});

test('falhas síncronas, rejeições tardias e cadastro vazio são tratados', async () => {
  const sincrono = new CatalogoProfissionais(() => { throw new Error('erro síncrono'); });
  assert.equal((await sincrono.consultar()).degradada, true);
  const tardio = new CatalogoProfissionais(async () => { await esperar(15); throw new Error('erro tardio'); }, { timeoutMs: 5 });
  assert.equal((await tardio.consultar()).degradada, true);
  await esperar(20);
  const vazio = await new CatalogoProfissionais(async () => []).consultar();
  assert.equal(vazio.degradada, false);
  assert.deepEqual(vazio.profissionais, []);
});

test('configuração inválida do catálogo falha na inicialização', () => {
  for (const opcoes of [{ ttlMs: -1 }, { maxStaleMs: -1 }, { timeoutMs: 0 }, { ttlMs: NaN }, { timeoutMs: Infinity }]) {
    assert.throws(() => new CatalogoProfissionais(async () => [], opcoes), /Prazos/);
  }
});
