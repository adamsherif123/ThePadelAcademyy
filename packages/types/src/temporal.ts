import type { Brand } from './brand';

/**
 * A UTC instant, ISO-8601 with a `Z` suffix, e.g. `2026-07-14T15:00:00.000Z`.
 * ALL stored timestamps are instants in UTC. They are rendered in Africa/Cairo
 * only at the display edge, by @tpa/core's formatters. This is the mirror of the
 * S5 `timestamptz` columns.
 */
export type IsoInstant = Brand<string, 'IsoInstant'>;

/**
 * A Cairo wall-clock time-of-day, `HH:mm` 24h, e.g. `18:00`. Used by
 * AvailabilityTemplate, which is a recurring weekly rule in LOCAL time — NOT an
 * instant. Turning a template into concrete SessionSlot instants must go through
 * @tpa/core's `materializeTemplateSlot`, which resolves the Cairo UTC offset
 * (incl. DST) for each target date. A naive fixed-offset conversion would shift
 * every slot by an hour on the two days a year Egypt changes its clocks.
 */
export type LocalTime = Brand<string, 'LocalTime'>;
