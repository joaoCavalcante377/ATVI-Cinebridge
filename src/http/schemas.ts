import { ESTRATEGIAS, PAPEIS } from '../domain/types.ts';

const texto = { type: 'string', minLength: 1, maxLength: 200 };
const dinheiro = { type: 'integer', minimum: 0, maximum: 1_000_000_000_000 };
const data = { type: 'string', format: 'date' };
const papel = { type: 'string', enum: PAPEIS };
const nivel = { type: 'number', minimum: 0, maximum: 5 };
const tipoCaptacao = { type: 'string', enum: ['documentario', 'ficcao', 'animacao'] };
const competencias = {
  type: 'array', maxItems: 50, items: {
    type: 'object', additionalProperties: false, required: ['nome', 'nivel'],
    properties: { nome: texto, nivel },
  },
};
export const parametrosSchema = {
  type: 'object', additionalProperties: false, properties: {
    pesoCompetencia: { type: 'number', minimum: 0, maximum: 1 },
    pesoAvaliacao: { type: 'number', minimum: 0, maximum: 1 },
    pesoPreco: { type: 'number', minimum: 0, maximum: 1 },
    limiteCandidatos: { type: 'integer', minimum: 1, maximum: 100 },
  },
};
export const projetoSchema = {
  type: 'object', additionalProperties: false,
  required: ['titulo', 'genero', 'duracaoMinutos', 'orcamentoCentavos', 'inicio', 'prazo', 'tipoCaptacao', 'localizacao', 'papeis', 'estrategia'],
  properties: {
    titulo: texto, genero: texto, duracaoMinutos: { type: 'number', exclusiveMinimum: 0, maximum: 100_000 },
    orcamentoCentavos: dinheiro, inicio: data, prazo: data, tipoCaptacao, localizacao: texto,
    estrategia: { type: 'string', enum: ESTRATEGIAS }, parametros: parametrosSchema,
    papeis: { type: 'array', minItems: 1, maxItems: 6, items: {
      type: 'object', additionalProperties: false, required: ['papel', 'peso', 'competencias'],
      properties: { papel, peso: { type: 'number', exclusiveMinimum: 0, maximum: 1_000 }, competencias },
    } },
  },
};
export const profissionalSchema = {
  type: 'object', additionalProperties: false,
  required: ['nome', 'email', 'papeis', 'competencias', 'precoCentavos', 'disponibilidade', 'localizacao', 'historico', 'avaliacoes'],
  properties: {
    nome: texto, email: { type: 'string', format: 'email', maxLength: 254 },
    papeis: { type: 'array', minItems: 1, maxItems: 6, uniqueItems: true, items: papel },
    competencias, precoCentavos: dinheiro, localizacao: texto,
    disponibilidade: { type: 'object', additionalProperties: false, required: ['inicio', 'fim'], properties: { inicio: data, fim: data } },
    historico: { type: 'array', maxItems: 100, items: {
      type: 'object', additionalProperties: false, required: ['genero', 'tipoCaptacao', 'papel'],
      properties: { genero: texto, tipoCaptacao, papel, projetoId: texto, nota: nivel },
    } },
    avaliacoes: { type: 'array', maxItems: 100, items: {
      type: 'object', additionalProperties: false, required: ['nota', 'comentario', 'data'],
      properties: { nota: nivel, comentario: { type: 'string', maxLength: 2_000 }, data },
    } },
  },
};
export const idParams = { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } };
export const membroParams = { type: 'object', required: ['id', 'papel'], properties: { ...idParams.properties, papel } };
export const conviteParams = { type: 'object', required: ['id', 'conviteId'], properties: { ...idParams.properties, conviteId: { type: 'string', format: 'uuid' } } };
export const aceitarSchema = { type: 'object', additionalProperties: false, properties: { papeis: { type: 'array', minItems: 1, maxItems: 6, uniqueItems: true, items: papel } } };
export const substituirSchema = { type: 'object', additionalProperties: false, properties: { profissionalId: { type: 'string', format: 'uuid' } } };
export const respostaSchema = { type: 'object', additionalProperties: false, required: ['profissionalId', 'resposta'], properties: {
  profissionalId: { type: 'string', format: 'uuid' }, resposta: { type: 'string', enum: ['ACEITO', 'RECUSADO'] },
} };
export const reavaliarSchema = { type: 'object', additionalProperties: false, properties: {
  orcamentoCentavos: dinheiro, inicio: data, prazo: data, estrategia: { type: 'string', enum: ESTRATEGIAS }, parametros: parametrosSchema,
} };
