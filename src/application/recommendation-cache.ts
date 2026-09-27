import { randomUUID } from 'node:crypto';
import type { ProfissionalDados, ProjetoDados } from '../domain/types.ts';
import { Projeto, ValidadorConsistencia } from '../domain/index.ts';
import { ErroDominio } from '../domain/types.ts';
import type { OrquestradorPadrao, ResultadoOrquestracao } from '../domain/index.ts';

/** Cache de cálculo, não de estado: cada projeto recebe IDs e objetos próprios.
 * O catálogo fornece um novo array quando é atualizado, invalidando os resultados.
 */
export class CacheRecomendacoes {
  private catalogo: ProfissionalDados[] | undefined;
  private resultados = new Map<string, ResultadoOrquestracao>();
  private orquestrador: OrquestradorPadrao;
  private limite: number;
  constructor(orquestrador: OrquestradorPadrao, limite = 64) {
    if (!Number.isInteger(limite) || limite < 1) throw new Error('Limite do cache deve ser positivo');
    this.orquestrador = orquestrador; this.limite = limite;
  }
  recomendar(projeto: ProjetoDados, profissionais: ProfissionalDados[]): ResultadoOrquestracao {
    const erros = new Projeto(projeto).aceitar(new ValidadorConsistencia());
    if (erros.length) throw new ErroDominio(erros.join(' '));
    if (profissionais !== this.catalogo) { this.catalogo = profissionais; this.resultados.clear(); }
    const { id: _id, titulo: _titulo, ...criterios } = projeto;
    const chave = JSON.stringify(criterios);
    let resultado = this.resultados.get(chave);
    if (!resultado) {
      resultado = this.orquestrador.orquestrar(projeto, profissionais);
      if (this.resultados.size >= this.limite) this.resultados.delete(this.resultados.keys().next().value!);
      this.resultados.set(chave, resultado);
    }
    const copia = structuredClone(resultado);
    copia.equipe.id = randomUUID(); copia.equipe.projetoId = projeto.id;
    return copia;
  }
}
