import test from 'node:test';
import assert from 'node:assert/strict';
import { CacheRecomendacoes } from '../src/application/recommendation-cache.ts';
import { OrquestradorPadrao } from '../src/domain/index.ts';
import { PARAMETROS_PADRAO } from '../src/domain/types.ts';
import { profissionaisExemplo, projetoExemplo } from '../scripts/fixtures.ts';

test('cache preserva isolamento, invalida cadastro novo e respeita limite', () => {
  const cache = new CacheRecomendacoes(new OrquestradorPadrao(), 1);
  const pessoas = profissionaisExemplo();
  const p = { ...projetoExemplo(), id: 'primeiro', parametros: PARAMETROS_PADRAO };
  const a = cache.recomendar(p, pessoas);
  const b = cache.recomendar({ ...p, id: 'segundo', titulo: 'Outra obra' }, pessoas);
  assert.notEqual(a.equipe.id, b.equipe.id);
  assert.equal(b.equipe.projetoId, 'segundo');
  a.equipe.membros[0]!.confirmado = true;
  assert.equal(b.equipe.membros[0]!.confirmado, false);
  const barato = cache.recomendar({ ...p, orcamentoCentavos: 1 }, pessoas);
  assert.equal(barato.equipe.status, 'PARCIAL');
  assert.equal(cache.recomendar(p, []).equipe.membros.length, 0);
  assert.equal(cache.recomendar(p, pessoas).equipe.membros.length, 6);
  assert.throws(() => cache.recomendar({ ...p, titulo: '' }, pessoas));
  assert.throws(() => new CacheRecomendacoes(new OrquestradorPadrao(), 0));
});
