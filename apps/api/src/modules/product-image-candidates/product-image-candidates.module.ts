import { Module } from "@nestjs/common";
import { ProductsModule } from "../products/products.module.js";
import { ImageFetcher, SafeImageFetcher } from "./image-fetcher.js";
import { ProductImageCandidatesController } from "./product-image-candidates.controller.js";
import { ProductImageCandidatesService } from "./product-image-candidates.service.js";

@Module({
  imports: [ProductsModule],
  controllers: [ProductImageCandidatesController],
  providers: [
    ProductImageCandidatesService,
    { provide: ImageFetcher, useFactory: () => new SafeImageFetcher() },
  ],
})
export class ProductImageCandidatesModule {}
