import { PAPEIS, ESTRATEGIAS } from './types.ts';
import type { Competencia, Equipe, ProfissionalDados, ProjetoDados, RequisitoPapel } from './types.ts';
import type { VisitanteProjeto, Projeto, Profissional } from './model.ts';

export const normalizarTexto = (valor: string): string => valor.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function dataValida(valor: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(valor) && Number.isFinite(Date.parse(valor)) && new Date(valor).toISOString().slice(0, 10) === valor;
}
const texto = (valor: string): boolean => typeof valor === 'string' && valor.trim().length > 0;
const nivelValido = (valor: number): boolean => Number.isFinite(valor) && valor >= 0 && valor <= 5;
function competenciasValidas(competencias: Competencia[]): boolean {
  return competencias.every(c => texto(c.nome) && nivelValido(c.nivel)) && new Set(competencias.map(c => normalizarTexto(c.nome))).size === competencias.length;
}

export class ValidadorConsistencia implements VisitanteProjeto<string[]> {
  readonly equipe: Equipe | undefined;
  constructor(equipe?: Equipe) { this.equipe = equipe; }
  visitarProjeto({ dados: p }: Projeto): string[] {
    const erros: string[] = [];
    if (![p.id, p.titulo, p.genero, p.localizacao].every(texto)) erros.push('Projeto exige id, título, gênero e localização.');
    if (!Number.isFinite(p.duracaoMinutos) || p.duracaoMinutos <= 0) erros.push('Duração deve ser positiva.');
    if (!Number.isSafeInteger(p.orcamentoCentavos) || p.orcamentoCentavos < 0) erros.push('Orçamento deve ser inteiro não negativo em centavos.');
    if (!dataValida(p.inicio) || !dataValida(p.prazo) || p.inicio > p.prazo) erros.push('Período do projeto inválido.');
    if (!['documentario', 'ficcao', 'animacao'].includes(p.tipoCaptacao)) erros.push('Tipo de captação inválido.');
    if (!ESTRATEGIAS.includes(p.estrategia)) erros.push('Estratégia inválida.');
    if (p.papeis.length < 1 || p.papeis.length > PAPEIS.length || new Set(p.papeis.map(r => r.papel)).size !== p.papeis.length) erros.push('Informe de um a seis papéis diferentes.');
    if (p.papeis.some(r => !PAPEIS.includes(r.papel) || !Number.isFinite(r.peso) || r.peso <= 0 || !competenciasValidas(r.competencias))) erros.push('Papel, peso ou competências inválidos.');
    const pesos = [p.parametros.pesoCompetencia, p.parametros.pesoAvaliacao, p.parametros.pesoPreco];
    if (pesos.some(v => !Number.isFinite(v) || v < 0 || v > 1) || pesos.reduce((a, b) => a + b, 0) === 0) erros.push('Pesos dos parâmetros devem estar entre zero e um, com soma positiva.');
    if (!Number.isInteger(p.parametros.limiteCandidatos) || p.parametros.limiteCandidatos < 1 || p.parametros.limiteCandidatos > 100) erros.push('Limite de candidatos deve estar entre 1 e 100.');
    if (this.equipe) {
      const e = this.equipe;
      if (e.projetoId !== p.id) erros.push('Equipe pertence a outro projeto.');
      if (p.papeis.some(r => !e.membros.some(m => m.papel === r.papel))) erros.push('Equipe não preenche todos os papéis exigidos.');
      if (e.membros.some(m => !p.papeis.some(r => r.papel === m.papel))) erros.push('Equipe contém papel não solicitado.');
      if (new Set(e.membros.map(m => m.papel)).size !== e.membros.length || new Set(e.membros.map(m => m.profissionalId)).size !== e.membros.length) erros.push('Equipe repete papel ou profissional.');
      const custo = e.membros.reduce((s, m) => s + m.precoCentavos, 0);
      if (e.membros.some(m => !Number.isSafeInteger(m.precoCentavos) || m.precoCentavos < 0) || custo !== e.custoCentavos || custo > p.orcamentoCentavos) erros.push('Custo da equipe inválido ou acima do orçamento.');
      const pendentes = p.papeis.map(r => r.papel).filter(papel => !e.membros.some(m => m.papel === papel));
      if (pendentes.length !== e.papeisPendentes.length || pendentes.some(papel => !e.papeisPendentes.includes(papel))) erros.push('Lista de papéis pendentes inconsistente.');
      if (e.status === 'CONFIRMADA' && (pendentes.length > 0 || e.membros.some(m => !m.confirmado || !m.aceitoProdutor))) erros.push('Equipe confirmada possui membro ou papel pendente.');
    }
    return erros;
  }

  visitarProfissional({ dados: p }: Profissional): string[] {
    const erros: string[] = [];
    if (![p.id, p.nome, p.email, p.localizacao].every(texto) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) erros.push('Identificação, email ou localização inválidos.');
    if (!Number.isSafeInteger(p.precoCentavos) || p.precoCentavos < 0) erros.push('Preço deve ser inteiro não negativo em centavos.');
    if (p.papeis.length === 0 || p.papeis.some(r => !PAPEIS.includes(r)) || new Set(p.papeis).size !== p.papeis.length) erros.push('Papéis do profissional inválidos.');
    if (!competenciasValidas(p.competencias)) erros.push('Competências inválidas ou repetidas.');
    if (!dataValida(p.disponibilidade.inicio) || !dataValida(p.disponibilidade.fim) || p.disponibilidade.inicio > p.disponibilidade.fim) erros.push('Disponibilidade inválida.');
    if (p.avaliacoes.some(a => !nivelValido(a.nota) || !dataValida(a.data))) erros.push('Avaliação inválida.');
    if (p.historico.some(h => !texto(h.genero) || !PAPEIS.includes(h.papel) || !['documentario', 'ficcao', 'animacao'].includes(h.tipoCaptacao) || (h.nota !== undefined && !nivelValido(h.nota)) || (h.projetoId !== undefined && !texto(h.projetoId)))) erros.push('Histórico inválido.');
    return erros;
  }
}

export function elegivel(p: ProfissionalDados, projeto: ProjetoDados, papel: RequisitoPapel): boolean {
  const local = normalizarTexto(p.localizacao), destino = normalizarTexto(projeto.localizacao);
  return p.papeis.includes(papel.papel) && p.disponibilidade.inicio <= projeto.inicio && p.disponibilidade.fim >= projeto.prazo && (local === destino || local === 'remoto' || destino === 'remoto');
}

export function similaridadeCompetencias(profissional: ProfissionalDados, requisito: RequisitoPapel): number {
  if (requisito.competencias.length === 0) return 1;
  const niveis = new Map(profissional.competencias.map(c => [normalizarTexto(c.nome), c.nivel]));
  let produto = 0, normaP = 0, normaR = 0, atendido = 0, solicitado = 0;
  for (const c of requisito.competencias) {
    const nivel = niveis.get(normalizarTexto(c.nome)) ?? 0;
    produto += nivel * c.nivel; normaP += nivel * nivel; normaR += c.nivel * c.nivel;
    atendido += Math.min(nivel, c.nivel); solicitado += c.nivel;
  }
  if (solicitado === 0) return 1;
  if (normaP === 0 || normaR === 0) return 0;
  // Cosseno sozinho dá 1 tanto para nível 1 quanto 5 em uma dimensão.
  // A cobertura impede que uma direção correta esconda falta de proficiência.
  return produto / Math.sqrt(normaP * normaR) * atendido / solicitado;
}

export class CalculadorCompatibilidade implements VisitanteProjeto<number> {
  readonly projeto: ProjetoDados;
  readonly profissionais: ProfissionalDados[];
  readonly equipe: Equipe | undefined;
  constructor(projeto: ProjetoDados, profissionais: ProfissionalDados[] = [], equipe?: Equipe) { this.projeto = projeto; this.profissionais = profissionais; this.equipe = equipe; }
  visitarProjeto({ dados }: Projeto): number {
    if (dados.papeis.length === 0) return 0;
    const somaPesos = dados.papeis.reduce((s, p) => s + p.peso, 0);
    return dados.papeis.reduce((s, papel) => {
      const candidatos = this.profissionais.filter(p => elegivel(p, dados, papel) && (!this.equipe || this.equipe.membros.some(m => m.papel === papel.papel && m.profissionalId === p.id)));
      return s + papel.peso * Math.max(0, ...candidatos.map(p => similaridadeCompetencias(p, papel)));
    }, 0) / somaPesos;
  }
  visitarProfissional({ dados }: Profissional): number {
    return Math.max(0, ...this.projeto.papeis.filter(p => elegivel(dados, this.projeto, p)).map(p => similaridadeCompetencias(dados, p)));
  }
}

export class GeradorRelatorio implements VisitanteProjeto<string> {
  readonly equipe: Equipe | undefined;
  readonly profissionais: ProfissionalDados[];
  constructor(equipe?: Equipe, profissionais: ProfissionalDados[] = []) { this.equipe = equipe; this.profissionais = profissionais; }
  visitarProjeto({ dados: p }: Projeto): string {
    const linhas = [`${p.titulo} (${p.genero}, ${p.tipoCaptacao}): ${p.papeis.map(r => r.papel).join(', ')}; orçamento R$ ${(p.orcamentoCentavos / 100).toFixed(2)}; ${p.inicio} a ${p.prazo}.`];
    if (this.equipe) {
      linhas.push(`Equipe ${this.equipe.id}: ${this.equipe.status}.`);
      for (const membro of this.equipe.membros) {
        const profissional = this.profissionais.find(p => p.id === membro.profissionalId);
        linhas.push(`${membro.papel}: ${profissional?.nome ?? membro.profissionalId}; R$ ${(membro.precoCentavos / 100).toFixed(2)}; pontuação ${membro.pontuacao.toFixed(3)}; produtor ${membro.aceitoProdutor ? 'aceitou' : 'pendente'}; profissional ${membro.confirmado ? 'confirmou' : 'pendente'}.`);
      }
      linhas.push(`Custo total: R$ ${(this.equipe.custoCentavos / 100).toFixed(2)}. Papéis pendentes: ${this.equipe.papeisPendentes.join(', ') || 'nenhum'}.`);
    }
    return linhas.join('\n');
  }
  visitarProfissional({ dados: p }: Profissional): string { return `${p.nome}: ${p.papeis.join(', ')}; ${p.localizacao}; preço R$ ${(p.precoCentavos / 100).toFixed(2)}; ${p.disponibilidade.inicio} a ${p.disponibilidade.fim}.`; }
}
