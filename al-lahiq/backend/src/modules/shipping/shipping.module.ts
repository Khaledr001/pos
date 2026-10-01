import { Controller, Get, Global, Module } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ManualCourierProvider } from './shipping-provider.js';
import { ShippingService } from './shipping.service.js';

@ApiTags('shipping')
@Controller('branches')
export class BranchesController {
  constructor(private readonly shipping: ShippingService) {}

  /** Branches with pickup slots. */
  @Get('pickup')
  pickup() {
    return this.shipping.pickupBranches();
  }
}

@Global()
@Module({
  controllers: [BranchesController],
  providers: [ShippingService, ManualCourierProvider],
  exports: [ShippingService, ManualCourierProvider],
})
export class ShippingModule {}
