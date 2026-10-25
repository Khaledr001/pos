import { describe, expect, it } from "vitest";
import type { TenantDatabase } from "../../../database/tenant-database.service.js";
import { ContentAdminService } from "./content-admin.service.js";
import { PageSchema, UpdatePageSchema } from "./dto.js";

const section = { id: "hero", type: "hero", enabled: true, settings: { variant: "minimal", headline: "Hi" } };

describe("page schemas", () => {
  it("applies defaults when a page is created", () => {
    expect(PageSchema.parse({ slug: "about", title: "About" })).toMatchObject({ body: "", kind: "page", isPublished: false });
  });

  it("leaves the layout to the column's own default when none is given", () => {
    expect(PageSchema.parse({ slug: "about", title: "About" })).not.toHaveProperty("layout");
    expect(PageSchema.parse({ slug: "about", title: "About", layout: "full" }).layout).toBe("full");
  });

  it("does not reset the body, kind, publication or layout when a PATCH names one field", () => {
    const parsed = UpdatePageSchema.parse({ title: "New title" });
    expect(parsed).toEqual({ title: "New title" });
  });

  it("takes sections (or null to go back to a text page) and validates them with the shared schema", () => {
    expect(UpdatePageSchema.safeParse({ sections: [section] }).success).toBe(true);
    expect(UpdatePageSchema.safeParse({ sections: null }).success).toBe(true);
    expect(UpdatePageSchema.safeParse({ sections: [{ ...section, settings: { ctaHref: "javascript:alert(1)" } }] }).success).toBe(false);
    expect(UpdatePageSchema.safeParse({ layout: "sidebar" }).success).toBe(false);
  });
});

describe("ContentAdminService — sections and blog posts", () => {
  const service = new ContentAdminService({ run: async () => { throw new Error("should not reach the database"); } } as unknown as TenantDatabase);

  it("refuses to build a blog post from sections", () => {
    expect(() => service.createPage({ slug: "post", title: "Post", body: "", kind: "blog", isPublished: false, sections: [section] } as never)).toThrow(/blog post is written as text/);
  });
});
