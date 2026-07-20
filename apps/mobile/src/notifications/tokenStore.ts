// The Expo push token for THIS device, remembered in-memory so the sign-out /
// account-deletion paths can delete exactly this row (and only this one) while the
// session is still valid. Not persisted: on a cold start the bridge re-registers and
// re-sets it. NotificationsBridge sets it; SessionProvider reads it to drop the token.
let current: string | null = null;

export const setLastPushToken = (token: string | null): void => {
  current = token;
};

export const getLastPushToken = (): string | null => current;
