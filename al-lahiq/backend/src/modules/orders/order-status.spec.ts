import { canTransition, nextStatuses } from './order-status.js';

describe('order status rules', () => {
  it('moves forward and may skip steps', () => {
    expect(canTransition('PLACED', 'CONFIRMED', 'COURIER', false)).toBe(true);
    expect(canTransition('PLACED', 'PACKED', 'COURIER', false)).toBe(true);
    expect(canTransition('PACKED', 'CONFIRMED', 'COURIER', false)).toBe(false);
  });

  it('keeps courier and pickup steps apart', () => {
    expect(canTransition('PACKED', 'SHIPPED', 'COURIER', false)).toBe(true);
    expect(canTransition('PACKED', 'READY_FOR_PICKUP', 'COURIER', false)).toBe(false);
    expect(canTransition('PACKED', 'READY_FOR_PICKUP', 'PICKUP', false)).toBe(true);
    expect(canTransition('READY_FOR_PICKUP', 'COLLECTED', 'PICKUP', false)).toBe(true);
    expect(canTransition('READY_FOR_PICKUP', 'DELIVERED', 'PICKUP', false)).toBe(false);
  });

  it('only allows PLACED from payment', () => {
    expect(canTransition('PENDING_PAYMENT', 'PLACED', 'COURIER', true)).toBe(true);
    expect(canTransition('CONFIRMED', 'PLACED', 'COURIER', true)).toBe(false);
    expect(canTransition('PENDING_PAYMENT', 'CONFIRMED', 'COURIER', true)).toBe(false);
  });

  it('cannot cancel once shipped', () => {
    expect(canTransition('PACKED', 'CANCELLED', 'COURIER', false)).toBe(true);
    expect(canTransition('SHIPPED', 'CANCELLED', 'COURIER', false)).toBe(false);
  });

  it('refunds only paid, finished orders', () => {
    expect(canTransition('CANCELLED', 'REFUNDED', 'COURIER', true)).toBe(true);
    expect(canTransition('CANCELLED', 'REFUNDED', 'COURIER', false)).toBe(false);
  });

  it('lists the admin choices', () => {
    expect(nextStatuses('PACKED', 'PICKUP', false)).toEqual(['READY_FOR_PICKUP', 'COLLECTED', 'CANCELLED']);
  });
});
