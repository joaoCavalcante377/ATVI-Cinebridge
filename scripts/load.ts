import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { cpus, platform, release, totalmem } from 'node:os';
import { criarDataSource, RepositorioPostgres } from '../src/infrastructure/database.ts';
import { ProfissionalEntity, CompetenciaEntity, AvaliacaoEntity } from '../src/infrastructure/entities.ts';
import { criarApp } from '../src/http/app.ts';
import { profissionaisExemplo } from './fixtures.ts';

if (!process.env.TEST_DATABASE_URL) throw new Error('Defina TEST_DATABASE_URL; a carga usa um schema isolado.');
const schema = `carga_${randomUUID().replaceAll('-', '')}`;
const db = criarDataSource(process.env.TEST_DATABASE_URL);
db.setOptions({ schema });
const { app, catalogo, worker } = criarApp(new RepositorioPostgres(db), { logger: false });
const executar = promisify(execFile);
const resultados: { estrategia: string; erros: number; maxMs: number; [key: string]: unknown }[] = [];
try {
  await db.initialize();
  await db.query(`CREATE SCHEMA "${schema}"`);
  await db.runMigrations();
  const pessoas = profissionaisExemplo(10_000);
  await db.transaction(async manager => {
    for (let i = 0; i < pessoas.length; i += 500) {
      const lote = pessoas.slice(i, i + 500);
      await manager.insert(ProfissionalEntity, lote.map(({ competencias: _c, avaliacoes: _a, ...p }) => p));
      await manager.insert(CompetenciaEntity, lote.flatMap(p => p.competencias.map((c, n) => ({ ...c, profissionalId: p.id, id: `${p.id}:c:${n}` }))));
      await manager.insert(AvaliacaoEntity, lote.flatMap(p => p.avaliacoes.map((a, n) => ({ ...a, profissionalId: p.id, id: `${p.id}:a:${n}` }))));
    }
  });
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  for (const estrategia of ['cosseno', 'colaborativa', 'orcamento']) {
    // Inclui leitura fria do PostgreSQL e primeiro cálculo; os demais pedidos
    // compartilham cadastro/critérios, mas persistem projetos independentes.
    catalogo.invalidar();
    const { stdout } = await executar(process.execPath, ['scripts/load-client.ts', base, estrategia, '100'], { timeout: 120_000 });
    const resultado = JSON.parse(stdout) as typeof resultados[number];
    resultados.push(resultado); console.log(resultado);
    while (await worker.processar()) { /* esvazia eventos antes da próxima rodada */ }
  }
  const relatorio = {
    data: new Date().toISOString(), node: process.version, postgres: (await db.query('SELECT version() AS versao'))[0].versao,
    sistema: `${platform()} ${release()}`, cpu: cpus()[0]?.model, processadoresLogicos: cpus().length,
    memoriaGB: Math.round(totalmem() / 1024 ** 3), profissionais: 10_000, loggerHttp: false,
    cenario: '100 POST concorrentes por estratégia; títulos diferentes e mesmos critérios. Cadastro e cálculo inicialmente frios; cache de critérios habilitado; PostgreSQL local real, HTTP TCP e cliente em processo separado; worker de eventos ativo.',
    resultados,
    aprovado: resultados.every(r => r.erros === 0 && r.maxMs < 2_000),
    limite: 'Não representa todas as combinações de projetos, hardware, rede ou histórico. Critérios distintos exigem novos cálculos; medir novamente no ambiente de destino.',
  };
  await writeFile(new URL('../docs/carga.json', import.meta.url), JSON.stringify(relatorio, null, 2) + '\n');
  if (!relatorio.aprovado) process.exitCode = 1;
} finally {
  await app.close();
  if (db.isInitialized) {
    if (!/^carga_[a-f0-9]{32}$/.test(schema)) throw new Error('Schema de teste inválido');
    await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await db.destroy();
  }
}
