import { PAPEIS } from '../src/domain/types.ts';
import type { ProfissionalDados } from '../src/domain/types.ts';
import type { NovoProjeto } from '../src/application/service.ts';

export function profissionaisExemplo(quantidade = 18): ProfissionalDados[] {
  return Array.from({ length: quantidade }, (_, i) => {
    const papel = PAPEIS[i % PAPEIS.length]!;
    const variante = Math.floor(i / PAPEIS.length) % 3;
    return {
      id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      nome: `${['Ana', 'Bruno', 'Carla', 'Diego', 'Elisa', 'Fábio'][i % 6]} ${i + 1}`,
      email: `profissional${i + 1}@example.com`, papeis: [papel],
      competencias: [{ nome: 'narrativa', nivel: [5, 3, 4][variante]! }, { nome: 'tecnica', nivel: [5, 3, 4][variante]! }],
      precoCentavos: [90_000, 40_000, 65_000][variante]!,
      disponibilidade: { inicio: '2026-01-01', fim: '2035-12-31' }, localizacao: 'São Paulo',
      historico: [
        { projetoId: 'curta-anterior-1', genero: 'drama', tipoCaptacao: 'ficcao', papel, nota: [3, 4, 5][variante]! },
        { projetoId: 'curta-anterior-2', genero: 'drama', tipoCaptacao: 'ficcao', papel, nota: [2, 3, 5][variante]! },
      ],
      avaliacoes: [{ nota: [3, 4, 5][variante]!, comentario: 'Dado fictício para demonstração.', data: '2026-06-01' }],
    };
  });
}

export function projetoExemplo(estrategia: NovoProjeto['estrategia'] = 'cosseno'): NovoProjeto {
  return {
    titulo: 'Entre cenas', genero: 'drama', duracaoMinutos: 20, orcamentoCentavos: 600_000,
    inicio: '2027-03-01', prazo: '2027-03-30', tipoCaptacao: 'ficcao', localizacao: 'São Paulo', estrategia,
    papeis: PAPEIS.map((papel, i) => ({ papel, peso: i === 0 ? 2 : 1, competencias: [{ nome: 'narrativa', nivel: 5 }, { nome: 'tecnica', nivel: 5 }] })),
  };
}
