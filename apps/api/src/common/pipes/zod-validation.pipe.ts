import { Injectable, PipeTransform } from "@nestjs/common";
import type { ZodType } from "zod";

/**
 * Validate and coerce a request payload against a Zod schema.
 *
 * Zod rather than class-validator: the same schema object validates in the API,
 * types the admin panel's form, and validates a row in the Excel importer.
 * class-validator's decorators only work on a class instance, which the
 * importer and the Electron renderer do not have.
 *
 *     const CreateBranchSchema = z.object({ name: z.string().min(1) });
 *     type CreateBranchDto = z.infer<typeof CreateBranchSchema>;
 *
 *     @Post()
 *     create(@Body(new ZodValidationPipe(CreateBranchSchema)) dto: CreateBranchDto) {}
 *
 * A ZodError thrown here is turned into field-level `details` by
 * AllExceptionsFilter, so the client gets `{ "name": ["Required"] }` rather
 * than one flattened string.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    // Deliberately `parse`, not `safeParse`: the filter turns the throw into a
    // 400 with per-field detail, and letting it propagate keeps this pipe from
    // having to know about HTTP.
    return this.schema.parse(value);
  }
}

/** Terser form for inline use: `@Body(zodPipe(Schema))`. */
export const zodPipe = <T>(schema: ZodType<T>) => new ZodValidationPipe(schema);
