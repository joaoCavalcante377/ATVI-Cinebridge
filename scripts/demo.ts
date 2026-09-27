import { projetoExemplo } from './fixtures.ts';
import type { EstadoProjeto } from '../src/domain/types.ts';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
async function post(caminho: string, dados: unknown): Promise<EstadoProjeto> {
  const resposta = await fetch(`${base}${caminho}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(dados) });
  if (!resposta.ok) throw new Error(`${resposta.status}: ${await resposta.text()}`);
  return await resposta.json() as EstadoProjeto;
}
for (const estrategia of ['cosseno', 'colaborativa', 'orcamento'] as const) {
  const estado = await post('/projetos', projetoExemplo(estrategia));
  console.log(estrategia, estado.equipe.membros.map(m => `${m.papel}: ${m.profissionalId.slice(-4)}`).join(', '), 'custo:', estado.equipe.custoCentavos / 100);
}
let estado = await post('/projetos', projetoExemplo());
const id = estado.projeto.id;
estado = await post(`/projetos/${id}/aceitar`, {});
const primeiro = estado.convites[0]!;
estado = await post(`/projetos/${id}/convites/${primeiro.id}/resposta`, { profissionalId: primeiro.profissionalId, resposta: 'RECUSADO' });
console.log('Recusa: novo membro sugerido, outros papéis preservados.');
estado = await post(`/projetos/${id}/aceitar`, {});
for (const convite of estado.convites.filter(c => c.status === 'PENDENTE')) {
  estado = await post(`/projetos/${id}/convites/${convite.id}/resposta`, { profissionalId: convite.profissionalId, resposta: 'ACEITO' });
}
console.log('Equipe:', estado.equipe.status, 'Projeto:', id);
const relatorio = await fetch(`${base}/projetos/${id}/relatorio`);
console.log(await relatorio.json());
console.log(`Auditoria e notificações assíncronas: ${base}/projetos/${id}/auditoria e /notificacoes`);
