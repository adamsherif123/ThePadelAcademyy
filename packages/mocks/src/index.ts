/**
 * @tpa/mocks — realistic, deterministic fixtures both apps render against until
 * live data lands (S9/S10). Built on @tpa/types + @tpa/core; anchored to a fixed
 * MOCK_NOW so relative data (upcoming slots, expiring/expired credits) is stable.
 * Pass MOCK_NOW as `now` to @tpa/core formatters/predicates for coherent output.
 */
export { MOCK_NOW, daysFromNow, egp } from './now';
export { mockCoaches, mockCurrentPlayer, mockPlayers } from './people';
export { ASSUMED_PACKAGE_IDS, mockPackages } from './catalog';
export { mockSlots, mockTemplates } from './schedule';
export { mockCreditBatches, mockPurchases } from './wallet';
export { mockBookings } from './bookings';
