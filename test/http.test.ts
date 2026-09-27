import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { criarApp } from '../src/http/app.ts';
import { RepositorioMemoria, projeto } from './support.ts';

test('HTTP diferencia persistência indisponível, conflitos e falhas inesperadas', async () => {
  const repo = new RepositorioMemoria();
  const { app } = criarApp(repo, { logger: false, worker: false });
  try {
    for (const [code, esperado] of [['ECONNREFUSED', 503], ['23505', 409], ['23503', 422], ['23514', 422], ['OUTRO', 500]] as const) {
      repo.buscarEstado = async () => { throw Object.assign(new Error('mensagem privada'), { code }); };
      const resposta = await app.inject(`/projetos/${randomUUID()}`);
      assert.equal(resposta.statusCode, esperado);
      assert.ok(!resposta.body.includes('mensagem privada'));
    }
    repo.buscarEstado = async () => { throw 'falha sem Error'; };
    assert.equal((await app.inject(`/projetos/${randomUUID()}`)).statusCode, 500);
    repo.verificar = async () => { throw new Error('offline'); };
    assert.equal((await app.inject('/ready')).statusCode, 503);
    assert.equal((await app.inject({ method: 'POST', url: '/projetos', payload: 'x'.repeat(300_000), headers: { 'content-type': 'application/json' } })).statusCode, 413);
  } finally { await app.close(); }
});

test('worker da aplicação entrega notificações sem bloquear a resposta HTTP', async () => {
  const repo = new RepositorioMemoria();
  const { app, worker } = criarApp(repo, { logger: false });
  try {
    const resposta = await app.inject({ method: 'POST', url: '/projetos', payload: projeto() });
    assert.equal(resposta.statusCode, 201, resposta.body);
    await worker.processar();
    assert.ok(repo.auditorias.size > 0);
  } finally { await app.close(); }
});
