/**
 * The Privacy Policy / Account Deletion pages, hosted as static routes on the admin
 * app's domain (apps/admin/public/privacy.html, delete-account.html — served outside
 * the admin's auth guard, reachable with no login).
 */
const ADMIN_DOMAIN = 'https://the-padel-academyy-admin.vercel.app';

export const PRIVACY_POLICY_URL = `${ADMIN_DOMAIN}/privacy.html`;
export const ACCOUNT_DELETION_URL = `${ADMIN_DOMAIN}/delete-account.html`;
