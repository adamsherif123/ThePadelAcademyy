import Ionicons from '@expo/vector-icons/Ionicons';
import { formatExpiry, formatInstantDate, formatInstantTime } from '@tpa/core';
import { letterSpacing, space } from '@tpa/theme';
import type { CreditBatchId } from '@tpa/types';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { packagesAtLocation } from '../../data/catalog';
import {
  useBatches,
  useBookings,
  useCoaches,
  useLocations,
  usePackages,
  useSlotsForBookings,
  useTrialEligible,
  combine,
} from '../../data/queries';
import { useLocation } from '../../location/LocationProvider';
import { LocationToggle } from '../../location/LocationToggle';
import { placeFor } from '../../location/slotLocation';
import { queryKeys } from '../../lib/queryClient';
import { nextSession, sessionCountdown } from '../../data/schedule';
import { batchesAtLocation, soonestExpiringBatch, totalReadyToBook } from '../../data/wallet';
import { NewsButton } from '../../notifications/NewsButton';
import { NotificationBell } from '../../notifications/NotificationBell';
import { useSession } from '../../session/SessionProvider';
import { useTheme } from '../../theme/ThemeProvider';
import {
  AcademyCard,
  Avatar,
  Button,
  Card,
  CreditsSummaryCard,
  ErrorView,
  InfoCard,
  LoadingView,
  PackageCard,
  Screen,
  ScreenHeader,
  Text,
  TRAINING_META,
  trainingMetaFor,
  useRefreshControl,
} from '../../ui';

/** Exactly what this screen reads — a pull here must not refetch purchases,
 *  notifications or news. Module-level so the array identity is stable. */
const HOME_KEYS = [
  queryKeys.creditBatches,
  queryKeys.bookings,
  queryKeys.slots,
  // Home's Upcoming spans branches via useSlotsForBookings, which fetches the
  // slots the branch feed does not hold BY ID. A pull that refreshed only the
  // feed left those cards on yesterday's data.
  queryKeys.slotsByIds,
  queryKeys.coaches,
  queryKeys.packages,
  queryKeys.trialEligible,
] as const;

export default function HomeScreen() {
  const router = useRouter();
  const { color } = useTheme();
  const refreshControl = useRefreshControl(HOME_KEYS);
  const styles = useMemo(
    () => StyleSheet.create({
      headerTrailing: { flexDirection: 'row', alignItems: 'center', gap: space.md },
      content: { gap: space.lg },
      emptyCredits: { gap: space.sm, alignItems: 'flex-start' },
      section: { gap: space.sm },
      sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
      nextHead: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginBottom: space.md },
      // The type yields and the countdown never does: the countdown is the point
      // of the row, and a long type name must truncate rather than push it off.
      nextType: { flex: 1, letterSpacing: letterSpacing.label },
      nextRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
      nextInfo: { flex: 1, gap: 2, minWidth: 0 },
      divider: { height: 1, backgroundColor: color.border.subtle, marginVertical: space.md },
      packageScroll: { gap: space.md, paddingVertical: space.xs },
    }),
    [color],
  );
  const { player, now } = useSession();
  const batches = useBatches();
  const bookings = useBookings();
  const { selectedId, selected } = useLocation();
  // Home's Upcoming list spans every branch, for the same reason Sessions does.
  const slots = useSlotsForBookings(now, selectedId, bookings.data ?? []);
  const coaches = useCoaches();
  const locationsQ = useLocations();
  const packagesQ = usePackages();
  const trialEligibleQ = useTrialEligible();
  const gate = combine(batches, bookings, coaches, packagesQ, trialEligibleQ);
  // Session-scoped, in-memory dismissals, keyed by batch id — a nag by design:
  // pure view state, resets on relaunch, and keying by id means dismissing one
  // batch's notice doesn't suppress a different batch's later.
  const [dismissed, setDismissed] = useState<Set<CreditBatchId>>(() => new Set());
  if (!player) return null;

  const firstName = player.name.split(' ')[0] ?? player.name;
  // The toggle rides WITH the header rather than being added to each Screen
  // separately: Home has three of them (loading, error, loaded) and they must
  // not drift apart. Its trailing slot is already the bell and news, so the pill
  // sits above rather than beside.
  const header = (
    <>
      <LocationToggle />
      <ScreenHeader
        eyebrow="The Padel Academy"
        title={`Hey, ${firstName}`}
        trailing={
          <View style={styles.headerTrailing}>
            <NotificationBell />
            <NewsButton />
          </View>
        }
      />
    </>
  );
  if (slots.isPending || gate.isPending) {
    return (
      <Screen scroll tabBar contentContainerStyle={styles.content}>
        {header}
        <LoadingView />
      </Screen>
    );
  }
  if (gate.isError) {
    return (
      <Screen scroll tabBar contentContainerStyle={styles.content} refreshControl={refreshControl}>
        {header}
        <ErrorView onRetry={gate.refetch} />
      </Screen>
    );
  }

  // The headline is EVERY credit the player owns, across branches — "how many
  // credits do I have" answered once, on the screen they open first. The wallet
  // is the per-branch view now: its number, its pills and its list all describe
  // the branch on the toggle.
  const locations = locationsQ.data ?? [];
  const locBatches = batchesAtLocation(batches.data ?? [], selectedId);
  const total = totalReadyToBook(batches.data ?? [], now);
  // How many of those actually work at the branch being browsed. The headline
  // must not be read as "you can book 14 sessions here" when 3 of them are an
  // hour's drive away, so wherever these differ the card says so.
  const here = totalReadyToBook(locBatches, now);
  const elsewhere = total - here;
  // The expiry nudge stays branch-scoped: it is a prompt to USE a credit, and a
  // credit expiring at a branch you are not at is not something to act on here.
  const expiring = soonestExpiringBatch(locBatches, now);
  const next = nextSession(bookings.data ?? [], slots.slots, coaches.data ?? [], now);
  // A5: only surface the trial while the player can still buy it (never used one) and one
  // exists — a player who has used their trial never sees it in their options anywhere.
  // SCOPED to the branch on the toggle, exactly like buy-credits (which "See all"
  // opens) and like the balance above. A package's credits are only spendable
  // where it was bought (065), so an unscoped strip here offered a player standing
  // at one branch a package for another — with nothing on the card to say so, and
  // a headline of 0 credits right above it. packagesAtLocation answers empty while
  // the branch is unresolved, which is the safe way round.
  const locPackages = packagesAtLocation(packagesQ.data ?? [], selectedId);
  const trialActive = locPackages.some((p) => p.trainingType === 'trial');
  const canGetTrial = Boolean(trialEligibleQ.data) && trialActive;
  const packages = locPackages.filter((p) => p.trainingType !== 'trial' || canGetTrial);

  const expiryText = expiring
    ? `${expiring.quantityRemaining} ${TRAINING_META[expiring.trainingType].label} credit${
        expiring.quantityRemaining === 1 ? '' : 's'
      } — ${formatExpiry(expiring.expiresAt, now)}`
    : undefined;

  return (
    <Screen scroll tabBar contentContainerStyle={styles.content} refreshControl={refreshControl}>
      {header}

      <CreditsSummaryCard
        total={total}
        eyebrow="Your credits"
        action={{ label: 'Wallet', trailingIcon: 'arrow-forward', onPress: () => router.push('/wallet') }}
      >
        {/* Only when they differ. With everything at one branch this is the
            headline restated, and a card that repeats itself reads as noise. */}
        {elsewhere > 0 && selected ? (
          <Text variant="caption" tone="inverse">
            {`${here} usable at ${selected.name}`}
          </Text>
        ) : null}
        {expiring && expiryText && !dismissed.has(expiring.id) ? (
          <InfoCard
            size="sm"
            variant="amber"
            text={expiryText}
            onDismiss={() => setDismissed((prev) => new Set(prev).add(expiring.id))}
          />
        ) : null}
      </CreditsSummaryCard>

      {/* Gated on what works HERE, not on the headline. A player with 14 credits
          at the other branch cannot book anything on this one, and offering them
          "Book a Session" would send them to a screen where every card is
          refused. */}
      {here === 0 ? (
        <Card style={styles.emptyCredits}>
          <Text variant="body" weight="bold">
            {elsewhere > 0 && selected ? `No credits at ${selected.name}` : 'You have no credits yet'}
          </Text>
          <Text variant="caption" tone="secondary">
            {/* Three different players, three different true things. Someone with
                credits at another branch is NOT starting from scratch and must not
                be told they are — they need to know the credits exist and that
                switching is a tap, not a purchase. */}
            {elsewhere > 0
              ? `You have ${elsewhere} credit${elsewhere === 1 ? '' : 's'} at another location. Buy credits for here, or switch location above to use them.`
              : canGetTrial
                ? 'Grab your one-time discounted trial session to book your first class on court.'
                : 'Add a credit package — a credit is what reserves your spot in a session.'}
          </Text>
          <Button
            label={canGetTrial ? 'Get your trial session' : 'Browse packages'}
            onPress={() => router.push('/buy-credits')}
          />
        </Card>
      ) : (
        <Button label="Book a Session" onPress={() => router.push('/(tabs)/book')} />
      )}

      {next ? (
        <View style={styles.section}>
          <Text variant="label">Next session</Text>
          {/* Tappable, to the same place a session notification goes: the Sessions
              tab, focused on this one. The card says what is next; the tab is
              where you do something about it. */}
          <Card
            onPress={() =>
              router.push({ pathname: '/(tabs)/sessions', params: { focus: next.slot.id } })
            }
          >
            {/* The type as a quiet label row, not a filled badge beside the time.
                As a badge it competed with the date for the same row and won —
                which is why "Wed 30 Sep · 7:30 PM" used to wrap mid-phrase. Up
                here it costs nothing and the time gets the width it needs.
                The countdown is the one thing the date does not tell you: whether
                this needs you now or sits somewhere later in the week. */}
            <View style={styles.nextHead}>
              <Ionicons
                name={trainingMetaFor(next.slot.trainingType).icon}
                size={13}
                color={color.text.muted}
              />
              <Text variant="micro" tone="muted" weight="bold" style={styles.nextType} numberOfLines={1}>
                {trainingMetaFor(next.slot.trainingType).label.toUpperCase()}
              </Text>
              <Text variant="micro" tone="accent" weight="bold">
                {sessionCountdown(next.slot.startsAt, now).toUpperCase()}
              </Text>
            </View>

            <View style={styles.nextRow}>
              <Avatar name={next.coach?.name ?? 'Coach'} imageUrl={next.coach?.photoUrl} size={48} />
              <View style={styles.nextInfo}>
                <Text variant="body" weight="bold" numberOfLines={1}>
                  {`${formatInstantDate(next.slot.startsAt)} · ${formatInstantTime(next.slot.startsAt)}`}
                </Text>
                {/* Coach and branch on one caption line. The full street was here
                    at body weight and wrapped to two lines for a fact you only
                    need on the way out the door — it is on the session itself. */}
                <Text variant="caption" tone="secondary" numberOfLines={1}>
                  {[next.coach ? `with ${next.coach.name}` : null, placeFor(next.slot.locationId, locations).name]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={color.text.muted} />
            </View>
          </Card>
        </View>
      ) : null}

      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Text variant="label">Add credits</Text>
          <Text variant="label" tone="accent" onPress={() => router.push('/buy-credits')}>
            See all
          </Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.packageScroll}>
          {packages.map((pkg) => (
            <PackageCard key={pkg.id} pkg={pkg} onPress={() => router.push(`/package/${pkg.id}`)} />
          ))}
        </ScrollView>
      </View>

      <View style={styles.section}>
        <Text variant="label">The academy</Text>
        <AcademyCard />
      </View>
    </Screen>
  );
}
