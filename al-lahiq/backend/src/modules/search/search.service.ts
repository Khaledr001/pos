import { Injectable } from '@nestjs/common';
import { PrismaService, Tx } from '../../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';

export interface SearchHit {
  productId: string;
  score: number;
}

/**
 * Search engine boundary. The default runs on PostgreSQL pg_trgm (typo
 * tolerant, no extra infrastructure). A Meilisearch implementation can replace
 * it later without changing callers.
 */
export interface SearchEngine {
  search(q: string, limit: number): Promise<SearchHit[]>;
}

/** pg_trgm-style trigram similarity, used to correct typos against the synonym list. */
export function trigramSimilarity(a: string, b: string): number {
  const grams = (w: string) => {
    const padded = `  ${w.toLowerCase()} `;
    const set = new Set<string>();
    for (let i = 0; i < padded.length - 2; i++) set.add(padded.slice(i, i + 3));
    return set;
  };
  const A = grams(a);
  const B = grams(b);
  let shared = 0;
  for (const g of A) if (B.has(g)) shared++;
  return shared / (A.size + B.size - shared);
}

/**
 * Expands a query with admin-defined synonym groups: "tap" → "faucet", "mixer".
 * Words close to a synonym ("fawcet") are corrected first.
 */
export function expandSynonyms(q: string, groups: string[][]): string[] {
  const normalized = q.trim().toLowerCase().replace(/\s+/g, ' ');
  const variants = new Set([normalized]);
  const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const allTerms = groups.flat();

  // Typo correction: swap a word for the closest synonym term.
  for (const word of normalized.split(' ')) {
    if (word.length < 4 || allTerms.includes(word)) continue;
    let best: { term: string; score: number } | null = null;
    for (const term of allTerms) {
      const score = trigramSimilarity(word, term);
      if (score >= 0.4 && (!best || score > best.score)) best = { term, score };
    }
    if (best) variants.add(normalized.replace(new RegExp(`\\b${escape(word)}\\b`), best.term));
  }

  for (const base of Array.from(variants)) {
    for (const group of groups) {
      for (const term of group) {
        const re = new RegExp(`\\b${escape(term)}\\b`);
        if (re.test(base)) {
          for (const alt of group) if (alt !== term) variants.add(base.replace(re, alt));
        }
      }
    }
  }
  return [...variants].slice(0, 8);
}

@Injectable()
export class SearchService implements SearchEngine {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async search(q: string, limit = 200): Promise<SearchHit[]> {
    const trimmed = q.trim();
    if (!trimmed) return [];
    const { synonyms } = await this.settings.get('search');
    const queries = expandSynonyms(trimmed, synonyms);

    const best = new Map<string, number>();
    // Slightly looser than the pg_trgm default (0.6) so one-letter typos match.
    const runs = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('pg_trgm.word_similarity_threshold', '0.45', true)`;
      const results: { id: string; score: number }[][] = [];
      for (const term of queries) results.push(await this.query(tx, term, trimmed, limit));
      return results;
    });
    for (const rows of runs) {
      for (const r of rows) {
        best.set(r.id, Math.max(best.get(r.id) ?? 0, Number(r.score)));
      }
    }
    return [...best.entries()]
      .map(([productId, score]) => ({ productId, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /** `raw` is the untouched query, for exact barcode matches. */
  private query(tx: Tx, term: string, raw: string, limit: number) {
    return tx.$queryRaw<{ id: string; score: number }[]>`
        SELECT p.id,
          GREATEST(
            word_similarity(${term}, lower(p.name)),
            MAX(CASE WHEN lower(v.sku) = ${term} OR v.barcode = ${raw} THEN 2
                     WHEN lower(v.sku) LIKE ${term + '%'} THEN 1.5 ELSE 0 END),
            MAX(word_similarity(${term}, lower(v.name))),
            COALESCE(word_similarity(${term}, lower(b.name)), 0) * 0.9
          )::float AS score
        FROM products p
        JOIN variants v ON v."productId" = p.id AND v.active
        LEFT JOIN brands b ON b.id = p."brandId"
        WHERE p.published AND (
          ${term} <% lower(p.name)
          OR lower(p.name) LIKE ${'%' + term + '%'}
          OR lower(v.sku) LIKE ${term + '%'}
          OR v.barcode = ${raw}
          OR ${term} <% lower(v.name)
          OR ${term} <% lower(coalesce(b.name, ''))
        )
        GROUP BY p.id, b.name
        ORDER BY score DESC
        LIMIT ${limit}`;
  }

  async log(term: string, results: number) {
    const t = term.trim().toLowerCase();
    if (t.length < 2) return;
    await this.prisma.searchLog.create({ data: { term: t.slice(0, 120), results } });
  }
}
