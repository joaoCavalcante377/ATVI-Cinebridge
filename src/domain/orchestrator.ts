import { randomUUID } from 'node:crypto';
import { ErroDominio } from './types.ts';
import type { Equipe, MembroEquipe, Papel, ProfissionalDados, ProjetoDados, Ranking } from './types.ts';
import { Projeto, Profissional } from './model.ts';
import { ValidadorConsistencia, elegivel } from './visitors.ts';
import { criarEstrategia } from './strategies.ts';
import { alocar } from './allocation.ts';

export interface OpcoesOrquestracao { fixos?: MembroEquipe[]; excluidos?: Partial<Record<Papel, string[]>>; cadastroIndisponivel?: boolean }
export interface ResultadoOrquestracao { equipe: Equipe; candidatos: Ranking; avisos: string[] }
type Fluxo = (projeto: ProjetoDados, profissionais: ProfissionalDados[], opcoes?: OpcoesOrquestracao) => ResultadoOrquestracao;

export abstract class OrquestradorEquipe {
  readonly orquestrar!: Fluxo;
  constructor() {
    // TypeScript não tem métodos final. Uma propriedade própria não gravável
    // mantém a ordem do template, mesmo diante de atribuições em runtime.
    Object.defineProperty(this, 'orquestrar', { configurable: false, writable: false, value: (projeto: ProjetoDados, profissionais: ProfissionalDados[], opcoes: OpcoesOrquestracao = {}): ResultadoOrquestracao => {
      this.validarRestricoes(projeto);
      const { profissionais: validos, avisos } = this.normalizarDados(projeto, profissionais);
      const fixos = opcoes.fixos ?? [];
      this.validarFixos(projeto, validos, fixos, opcoes.excluidos ?? {}, opcoes.cadastroIndisponivel ?? false);
      if (opcoes.cadastroIndisponivel && fixos.some(f => !validos.some(p => p.id === f.profissionalId))) avisos.push('Escolhas fixas preservadas; disponibilidade não pôde ser revalidada porque o cadastro está indisponível.');
      const idsFixos = new Set(fixos.map(f => f.profissionalId));
      const recomendacoes = criarEstrategia(projeto).recomendar(projeto, validos.filter(p => !idsFixos.has(p.id)));
      for (const requisito of projeto.papeis) recomendacoes[requisito.papel] = (recomendacoes[requisito.papel] ?? []).filter(c => !(opcoes.excluidos?.[requisito.papel] ?? []).includes(c.profissionalId));
      return this.posProcessar(projeto, recomendacoes, fixos, avisos);
    } });
  }
  protected abstract validarRestricoes(projeto: ProjetoDados): void;
  protected abstract normalizarDados(projeto: ProjetoDados, profissionais: ProfissionalDados[]): { profissionais: ProfissionalDados[]; avisos: string[] };
  protected abstract posProcessar(projeto: ProjetoDados, recomendacoes: Ranking, fixos: MembroEquipe[], avisos: string[]): ResultadoOrquestracao;

  private validarFixos(projeto: ProjetoDados, profissionais: ProfissionalDados[], fixos: MembroEquipe[], excluidos: Partial<Record<Papel, string[]>>, cadastroIndisponivel: boolean): void {
    if (new Set(fixos.map(f => f.papel)).size !== fixos.length || new Set(fixos.map(f => f.profissionalId)).size !== fixos.length) throw new ErroDominio('Membros fixos repetem papel ou profissional.');
    const porId = new Map(profissionais.map(p => [p.id, p]));
    for (const fixo of fixos) {
      const requisito = projeto.papeis.find(r => r.papel === fixo.papel), profissional = porId.get(fixo.profissionalId);
      if (!requisito || (!profissional && !cadastroIndisponivel) || (profissional && !elegivel(profissional, projeto, requisito)) || excluidos[fixo.papel]?.includes(fixo.profissionalId)) throw new ErroDominio('Membro fixo não é elegível para o papel.');
      if (!Number.isSafeInteger(fixo.precoCentavos) || fixo.precoCentavos < 0 || !Number.isFinite(fixo.pontuacao) || fixo.pontuacao < 0 || fixo.pontuacao > 1) throw new ErroDominio('Preço ou pontuação do membro fixo inválido.');
    }
    if (fixos.reduce((s, f) => s + f.precoCentavos, 0) > projeto.orcamentoCentavos) throw new ErroDominio('Membros fixos ultrapassam o orçamento.');
  }
}

export class OrquestradorPadrao extends OrquestradorEquipe {
  protected validarRestricoes(projeto: ProjetoDados): void {
    const erros = new Projeto(projeto).aceitar(new ValidadorConsistencia());
    if (erros.length) throw new ErroDominio(erros.join(' '));
  }
  protected normalizarDados(_projeto: ProjetoDados, profissionais: ProfissionalDados[]): { profissionais: ProfissionalDados[]; avisos: string[] } {
    const validador = new ValidadorConsistencia(), vistos = new Set<string>(), validos: ProfissionalDados[] = [];
    let descartados = 0;
    for (const profissional of profissionais) {
      if (vistos.has(profissional.id) || new Profissional(profissional).aceitar(validador).length) { descartados++; continue; }
      vistos.add(profissional.id); validos.push(profissional);
    }
    // Ordenação estabiliza a amostra de vizinhos colaborativos e os desempates.
    validos.sort((a, b) => a.id.localeCompare(b.id));
    return { profissionais: validos, avisos: descartados ? [`${descartados} cadastro(s) inválido(s) ou duplicado(s) ignorado(s).`] : [] };
  }
  protected posProcessar(projeto: ProjetoDados, recomendacoes: Ranking, fixos: MembroEquipe[], avisos: string[]): ResultadoOrquestracao {
    const { membros, papeisPendentes } = alocar(projeto, recomendacoes, fixos);
    const candidatos: Ranking = {};
    for (const requisito of projeto.papeis) candidatos[requisito.papel] = (recomendacoes[requisito.papel] ?? []).slice(0, projeto.parametros.limiteCandidatos);
    if (papeisPendentes.length) avisos.push(`Equipe parcial: sem combinação elegível dentro do orçamento para todos os papéis. Pendentes: ${papeisPendentes.join(', ')}.`);
    const status: Equipe['status'] = papeisPendentes.length ? 'PARCIAL' : membros.every(m => m.confirmado) ? 'CONFIRMADA' : membros.every(m => m.aceitoProdutor) ? 'AGUARDANDO' : 'SUGERIDA';
    return { equipe: { id: randomUUID(), projetoId: projeto.id, membros, papeisPendentes, custoCentavos: membros.reduce((s, m) => s + m.precoCentavos, 0), status }, candidatos, avisos };
  }
}
