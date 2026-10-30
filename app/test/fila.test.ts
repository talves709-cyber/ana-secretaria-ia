import { describe, expect, it, vi } from 'vitest';
import { agendarCicloAna, INTERVALO_CICLO_ANA_MS, removerCicloAna } from '../src/fila.js';

describe('agendador do ciclo da Ana', () => {
  it('ligar e desligar usam o mesmo agendador', async () => {
    const fila = { upsertJobScheduler: vi.fn(async () => undefined), removeJobScheduler: vi.fn(async () => true) };
    await agendarCicloAna(fila as never);
    await removerCicloAna(fila as never);
    expect(fila.upsertJobScheduler).toHaveBeenCalledWith('ciclo', { every: INTERVALO_CICLO_ANA_MS }, { name: 'ciclo' });
    expect(fila.removeJobScheduler).toHaveBeenCalledWith('ciclo');
  });
});
