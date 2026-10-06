import { and, asc, count, desc, eq, ilike, inArray, isNull, ne, or, schema, sql } from "@devsfleet/db";
import type { ImageCandidateStatus, Paginated } from "@devsfleet/shared-types";
import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { RequestContext } from "../../common/context/request-context.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import { MAX_IMAGE_BYTES, ProductsService } from "../products/products.service.js";
import type { BulkCandidatesDto, ListCandidatesDto } from "./dto.js";
import { ImageFetcher } from "./image-fetcher.js";

type CandidateRow = typeof schema.productImageCandidates.$inferSelect;
type ImageRow = typeof schema.productImages.$inferSelect;

export interface CandidateView {
  id: string;
  imageUrl: string;
  thumbnailUrl: string | null;
  sourcePageUrl: string;
  sourceDomain: string;
  title: string | null;
  width: number | null;
  height: number | null;
  matchScore: number;
  query: string | null;
  status: ImageCandidateStatus;
}

export interface ReviewProduct {
  productId: string;
  name: string;
  sku: string;
  imageUrl: string | null;
  brand: string | null;
  category: string | null;
  candidates: CandidateView[];
}

export interface ReviewSummary {
  totalProducts: number;
  /** Products that already have a primary image. */
  withImage: number;
  /** No image, but a reviewer has rejected everything found. They stay on the placeholder. */
  rejectedOnly: number;
  /** No image and pending candidates waiting for a decision. */
  awaitingReview: number;
  /** No image and nothing found yet — the finder has not covered them. */
  needSearch: number;
}

export interface BulkResult {
  received: number;
  inserted: number;
  /** Already stored for that product — the idempotent no-op. */
  skipped: number;
  unknownProducts: string[];
}

const hostOf = (url: string): string => new URL(url).hostname.toLowerCase().replace(/^www\./, "");

/**
 * Candidate photos found on the web, and the human decision that turns one
 * into a real product image.
 *
 * A candidate is only a link to somebody else's server. Nothing reaches the
 * storefront until `approve` downloads it — through the SSRF-guarded fetcher —
 * and hands the bytes to ProductsService.addImage, the one upload path, so
 * checksum dedup and "first image is primary" behave exactly as for a manual
 * upload.
 */
@Injectable()
export class ProductImageCandidatesService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly products: ProductsService,
    private readonly fetcher: ImageFetcher,
  ) {}

  async bulkCreate(dto: BulkCandidatesDto): Promise<BulkResult> {
    const tenantId = RequestContext.requireTenantId();

    // The FK check ignores RLS, so a foreign tenant's product id would be
    // accepted by the database. Resolve ids through RLS first.
    const requested = [...new Set(dto.candidates.map((c) => c.productId))];
    const known = await this.db.run((tx) =>
      tx
        .select({ id: schema.products.id })
        .from(schema.products)
        .where(and(inArray(schema.products.id, requested), isNull(schema.products.deletedAt))),
    );
    const knownIds = new Set(known.map((p) => p.id));
    const unknownProducts = requested.filter((id) => !knownIds.has(id));

    const rows = dto.candidates
      .filter((c) => knownIds.has(c.productId))
      .map((c) => ({
        tenantId,
        productId: c.productId,
        imageUrl: c.imageUrl,
        thumbnailUrl: c.thumbnailUrl ?? null,
        sourcePageUrl: c.sourcePageUrl,
        // Derived here, never trusted from the client: it is what the reviewer reads as "who is this".
        sourceDomain: hostOf(c.sourcePageUrl),
        title: c.title ?? null,
        width: c.width ?? null,
        height: c.height ?? null,
        matchScore: c.matchScore,
        query: c.query ?? null,
      }));

    // The same (product, imageUrl) twice in one request would make
    // ON CONFLICT DO NOTHING hide it, but dedupe anyway so the counts are honest.
    const unique = [...new Map(rows.map((r) => [`${r.productId}|${r.imageUrl}`, r])).values()];

    let inserted = 0;
    if (unique.length > 0) {
      const created = await this.db.run((tx) =>
        tx
          .insert(schema.productImageCandidates)
          .values(unique)
          .onConflictDoNothing({
            target: [
              schema.productImageCandidates.tenantId,
              schema.productImageCandidates.productId,
              schema.productImageCandidates.imageUrl,
            ],
          })
          .returning({ id: schema.productImageCandidates.id }),
      );
      inserted = created.length;
    }

    return {
      received: dto.candidates.length,
      inserted,
      skipped: unique.length - inserted,
      unknownProducts,
    };
  }

  async list(query: ListCandidatesDto): Promise<Paginated<ReviewProduct>> {
    const { page, limit, status, categoryId, brandId, q, onlyWithoutImage } = query;
    const offset = (page - 1) * limit;
    const P = schema.products;
    const C = schema.productImageCandidates;

    const where = and(
      isNull(P.deletedAt),
      eq(P.isActive, true),
      onlyWithoutImage ? isNull(P.imageUrl) : undefined,
      // A parent category includes everything beneath it (materialised path "a/b/c").
      categoryId
        ? sql`${P.categoryId} IN (
            SELECT c.id FROM categories c
            WHERE c.id = ${categoryId}
               OR c.path LIKE (SELECT path FROM categories WHERE id = ${categoryId}) || '/%'
          )`
        : undefined,
      brandId ? eq(P.brandId, brandId) : undefined,
      q ? or(ilike(P.name, `%${q}%`), ilike(P.sku, `%${q}%`)) : undefined,
      sql`EXISTS (SELECT 1 FROM ${C} c WHERE c.product_id = ${P.id} AND c.status = ${status})`,
    );

    return this.db.run(async (tx) => {
      const [totalRow] = await tx.select({ value: count() }).from(P).where(where);
      const total = totalRow?.value ?? 0;

      const productRows = await tx
        .select({
          productId: P.id,
          name: P.name,
          sku: P.sku,
          imageUrl: P.imageUrl,
          brand: schema.brands.name,
          category: schema.categories.name,
        })
        .from(P)
        .leftJoin(schema.brands, eq(schema.brands.id, P.brandId))
        .leftJoin(schema.categories, eq(schema.categories.id, P.categoryId))
        .where(where)
        .orderBy(asc(P.name), asc(P.id))
        .limit(limit)
        .offset(offset);

      const ids = productRows.map((p) => p.productId);
      const candidateRows: CandidateRow[] =
        ids.length === 0
          ? []
          : await tx
              .select()
              .from(C)
              .where(and(inArray(C.productId, ids), eq(C.status, status)))
              .orderBy(desc(C.matchScore), asc(C.createdAt));

      const byProduct = new Map<string, CandidateView[]>();
      for (const row of candidateRows) {
        const list = byProduct.get(row.productId) ?? [];
        list.push(toView(row));
        byProduct.set(row.productId, list);
      }

      const totalPages = Math.max(1, Math.ceil(total / limit));
      return {
        items: productRows.map((p) => ({ ...p, candidates: byProduct.get(p.productId) ?? [] })),
        meta: { page, limit, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
      };
    });
  }

  /** Progress counters for the review screen. Separate from `list` because the list envelope carries only items + paging. */
  getSummary(): Promise<ReviewSummary> {
    return this.db.run((tx) => this.summary(tx));
  }

  async approve(id: string): Promise<{ candidate: CandidateView; image: ImageRow }> {
    const { candidate, productName } = await this.db.run(async (tx) => {
      const row = await tx.query.productImageCandidates.findFirst({ where: (t, { eq: e }) => e(t.id, id) });
      if (!row) throw new AppError(ERROR_CODES.NOT_FOUND, `Image candidate ${id} not found`);
      if (row.status === "approved") {
        throw new AppError(ERROR_CODES.CONFLICT, "This candidate has already been approved.");
      }
      const product = await tx.query.products.findFirst({
        where: (t, { eq: e, and: a, isNull: n }) => a(e(t.id, row.productId), n(t.deletedAt)),
        columns: { name: true },
      });
      if (!product) throw new AppError(ERROR_CODES.PRODUCT_NOT_FOUND, `Product ${row.productId} not found`);
      return { candidate: row, productName: product.name };
    });

    // Outside any transaction on purpose: a slow third-party host must not
    // hold a database connection open.
    const fetched = await this.fetcher.fetch(candidate.imageUrl, MAX_IMAGE_BYTES);
    const checksum = createHash("sha256").update(fetched.buffer).digest("hex");

    const existing = await this.db.run((tx) =>
      tx.query.productImages.findFirst({ where: (t, { eq: e }) => e(t.checksum, checksum) }),
    );
    if (existing && existing.productId !== candidate.productId) {
      throw new AppError(ERROR_CODES.DUPLICATE_IMAGE, "This exact image is already attached to a different product.");
    }

    let image: ImageRow;
    if (existing) {
      // A previous approval stored the image but died before marking the
      // candidate; finish the bookkeeping rather than strand it.
      image = existing;
    } else {
      const primary = await this.db.run((tx) =>
        tx.query.productImages.findFirst({
          where: (t, { and: a, eq: e }) => a(e(t.productId, candidate.productId), e(t.isPrimary, true)),
          columns: { id: true },
        }),
      );
      image = await this.products.addImage(
        candidate.productId,
        {
          buffer: fetched.buffer,
          mimetype: fetched.mimeType,
          size: fetched.buffer.length,
        } as Express.Multer.File,
        {
          isPrimary: !primary,
          altText: productName.slice(0, 255),
          source: candidate.sourceDomain,
          sourceUrl: candidate.sourcePageUrl.slice(0, 1000),
        },
      );
    }

    const approved = await this.markReviewed([eq(schema.productImageCandidates.id, id)], "approved");
    const row = approved[0];
    if (!row) throw new AppError(ERROR_CODES.NOT_FOUND, `Image candidate ${id} not found`);
    return { candidate: toView(row), image };
  }

  async reject(id: string): Promise<CandidateView> {
    const rows = await this.markReviewed(
      [eq(schema.productImageCandidates.id, id), ne(schema.productImageCandidates.status, "approved")],
      "rejected",
    );
    const row = rows[0];
    if (!row) throw new AppError(ERROR_CODES.NOT_FOUND, `Pending image candidate ${id} not found`);
    return toView(row);
  }

  async rejectAll(productId: string): Promise<{ rejected: number }> {
    const rows = await this.markReviewed(
      [
        eq(schema.productImageCandidates.productId, productId),
        eq(schema.productImageCandidates.status, "pending"),
      ],
      "rejected",
    );
    return { rejected: rows.length };
  }

  private async markReviewed(
    conditions: Array<ReturnType<typeof eq>>,
    status: Extract<ImageCandidateStatus, "approved" | "rejected">,
  ): Promise<CandidateRow[]> {
    const reviewer = RequestContext.get()?.user?.id ?? null;
    return this.db.run((tx) =>
      tx
        .update(schema.productImageCandidates)
        .set({ status, reviewedBy: reviewer, reviewedAt: new Date() })
        .where(and(...conditions))
        .returning(),
    );
  }

  private async summary(tx: Parameters<Parameters<TenantDatabase["run"]>[0]>[0]): Promise<ReviewSummary> {
    const [row] = await tx.execute<{
      total: string;
      with_image: string;
      awaiting: string;
      rejected_only: string;
    }>(sql`
      SELECT
        count(*) AS total,
        count(*) FILTER (WHERE p.image_url IS NOT NULL) AS with_image,
        count(*) FILTER (WHERE p.image_url IS NULL AND EXISTS (
          SELECT 1 FROM product_image_candidates c WHERE c.product_id = p.id AND c.status = 'pending')) AS awaiting,
        count(*) FILTER (WHERE p.image_url IS NULL
          AND NOT EXISTS (SELECT 1 FROM product_image_candidates c WHERE c.product_id = p.id AND c.status = 'pending')
          AND EXISTS (SELECT 1 FROM product_image_candidates c WHERE c.product_id = p.id AND c.status = 'rejected')) AS rejected_only
      FROM products p
      WHERE p.deleted_at IS NULL AND p.is_active = true
    `);
    const totalProducts = Number(row?.total ?? 0);
    const withImage = Number(row?.with_image ?? 0);
    const awaitingReview = Number(row?.awaiting ?? 0);
    const rejectedOnly = Number(row?.rejected_only ?? 0);
    return {
      totalProducts,
      withImage,
      awaitingReview,
      rejectedOnly,
      needSearch: Math.max(0, totalProducts - withImage - awaitingReview - rejectedOnly),
    };
  }
}

function toView(row: CandidateRow): CandidateView {
  return {
    id: row.id,
    imageUrl: row.imageUrl,
    thumbnailUrl: row.thumbnailUrl,
    sourcePageUrl: row.sourcePageUrl,
    sourceDomain: row.sourceDomain,
    title: row.title,
    width: row.width,
    height: row.height,
    matchScore: row.matchScore,
    query: row.query,
    status: row.status,
  };
}
