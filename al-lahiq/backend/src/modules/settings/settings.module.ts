import { Global, Module } from '@nestjs/common';
import { CountersService } from './counters.service.js';
import { SettingsService } from './settings.service.js';

@Global()
@Module({
  providers: [SettingsService, CountersService],
  exports: [SettingsService, CountersService],
})
export class SettingsModule {}
