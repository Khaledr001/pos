import { Injectable } from '@nestjs/common';
import { PrismaService, Tx } from '../../prisma/prisma.service.js';

/** Admin-editable settings with typed defaults. */
export interface SettingsShape {
  store: {
    name: string;
    legalName: string;
    trn: string; // shown on every tax invoice
    address: string;
    phone: string;
    email: string;
    whatsapp: string; // digits only, e.g. 9715xxxxxxxx
  };
  cod: { enabled: boolean; maxFils: number };
  stock: {
    safetyBuffer: number; // base units held back from online sale per SKU/branch
    fulfilmentBranchCode: string; // ships courier orders
  };
  pickup: {
    leadHours: number;
    slotMinutes: number;
    daysAhead: number;
    openHour: number;
    closeHour: number;
  };
  search: { synonyms: string[][] };
}

export const SETTING_DEFAULTS: SettingsShape = {
  store: {
    name: 'Al-Lahiq Building Materials',
    legalName: 'Al-Lahiq Building Materials Trading LLC',
    trn: '100000000000003',
    address: 'Industrial Area, Dubai, UAE',
    phone: '+971 4 000 0000',
    email: 'sales@example.ae',
    whatsapp: '971500000000',
  },
  cod: { enabled: true, maxFils: 200_000 },
  stock: { safetyBuffer: 2, fulfilmentBranchCode: 'MAIN' },
  pickup: { leadHours: 2, slotMinutes: 120, daysAhead: 3, openHour: 8, closeHour: 20 },
  search: {
    synonyms: [
      ['tap', 'faucet', 'mixer'],
      ['wc', 'toilet', 'commode'],
      ['basin', 'sink', 'washbasin'],
      ['cable', 'wire'],
      ['bulb', 'lamp'],
      ['drill', 'driver'],
      ['pvc', 'upvc'],
      ['breaker', 'mcb'],
    ],
  },
};

export type SettingKey = keyof SettingsShape;

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get<K extends SettingKey>(key: K, tx?: Tx): Promise<SettingsShape[K]> {
    const row = await (tx ?? this.prisma).setting.findUnique({ where: { key } });
    const defaults = SETTING_DEFAULTS[key];
    if (!row) return defaults;
    if (Array.isArray(defaults) || typeof defaults !== 'object') {
      return row.value as SettingsShape[K];
    }
    return { ...defaults, ...(row.value as object) } as SettingsShape[K];
  }

  async all(): Promise<SettingsShape> {
    const rows = await this.prisma.setting.findMany();
    const out = structuredClone(SETTING_DEFAULTS) as unknown as Record<string, unknown>;
    for (const row of rows) {
      if (row.key in out) {
        out[row.key] = { ...(out[row.key] as object), ...(row.value as object) };
      }
    }
    return out as unknown as SettingsShape;
  }

  async set<K extends SettingKey>(key: K, value: Partial<SettingsShape[K]>) {
    const merged = { ...(await this.get(key)), ...value };
    await this.prisma.setting.upsert({
      where: { key },
      create: { key, value: merged as object },
      update: { value: merged as object },
    });
    return merged;
  }
}
