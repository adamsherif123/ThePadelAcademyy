import { EmptyState } from './EmptyState';

/**
 * What a coach screen shows when the signed-in account has no `coach_id`.
 *
 * This should be unreachable — the routing fork only sends a LINKED coach into the
 * coach app, and sends anyone else out. But "unreachable" is what the coach app
 * quietly assumed once before: a duplicate route-group name broke the redirect out,
 * an unlinked account sat in the coach shell, and every screen showed a spinner
 * forever because its query was gated off and a disabled query never stops pending.
 *
 * So the state is drawn rather than assumed away. If it is ever reached again the
 * screen says what is wrong and who can fix it, instead of pretending to load.
 * One component so all three screens say the same thing.
 */
export function CoachNotLinked() {
  return (
    <EmptyState
      icon="person-outline"
      title="Not linked to a coach"
      message="This account isn't connected to a coach profile yet, so there's no schedule to show. The academy can link it from the admin."
    />
  );
}
