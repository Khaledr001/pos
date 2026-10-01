import { Global, Module } from '@nestjs/common';
import { SearchService } from '../search/search.service.js';
import { CatalogIndexer } from './catalog-indexer.service.js';
import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';

@Global()
@Module({
  controllers: [CatalogController],
  providers: [CatalogService, CatalogIndexer, SearchService],
  exports: [CatalogService, CatalogIndexer, SearchService],
})
export class CatalogModule {}
