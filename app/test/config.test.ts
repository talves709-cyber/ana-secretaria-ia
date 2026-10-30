import { describe, expect, it } from 'vitest';
import { lerConfig } from '../src/config.js';

const BASE = {
  DATABASE_URL: 'postgres://x',
  REDIS_URL: 'redis://x',
  EVOLUTION_URL: 'http://evolution:8080',
  EVOLUTION_API_KEY: 'a'.repeat(20),
  WEBHOOK_URL: 'http://app:3100/webhook',
  WEBHOOK_TOKEN: 'b'.repeat(20),
  PAINEL_SENHA: 'c'.repeat(14),
  SESSAO_SEGREDO: 'd'.repeat(40),
};

describe('DONO_WHATSAPP e DONO_JIDS_EXTRA', () => {
  it('aceita só dígitos com DDI', () => {
    expect(lerConfig({ ...BASE, DONO_WHATSAPP: '5500000000000' }).DONO_WHATSAPP).toBe('5500000000000');
  });

  it('recusa número formatado', () => {
    expect(() => lerConfig({ ...BASE, DONO_WHATSAPP: '+55 11 90000-0000' })).toThrow(/DONO_WHATSAPP/);
  });

  it('vazio ou ausente desliga o recurso', () => {
    expect(lerConfig({ ...BASE, DONO_WHATSAPP: '' }).DONO_WHATSAPP).toBeUndefined();
    expect(lerConfig(BASE).DONO_JIDS_EXTRA).toEqual([]);
  });

  it('lista os JIDs extras separados por vírgula', () => {
    expect(lerConfig({ ...BASE, DONO_JIDS_EXTRA: '1@lid, 2@lid,' }).DONO_JIDS_EXTRA).toEqual(['1@lid', '2@lid']);
  });
});
