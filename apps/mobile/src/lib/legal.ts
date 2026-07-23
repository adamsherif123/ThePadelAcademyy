/**
 * The Privacy Policy / Account Deletion pages, hosted as static routes on the admin
 * app's domain (apps/admin/public/privacy.html, delete-account.html — served outside
 * the admin's auth guard, reachable with no login).
 *
 * TODO(Adam): the admin app hasn't been deployed yet (see the B2 report, Task 8 — the
 * Vercel domain isn't known until you deploy it). Replace ADMIN_DOMAIN below with the
 * real deployed URL (e.g. 'https://admin.thepadelacademy.eg' or the *.vercel.app one)
 * the moment it exists. Same pattern as INSTAPAY_PAYEE_NAME in request-credits.tsx —
 * a clearly-marked placeholder until the real value lands.
 */
const ADMIN_DOMAIN = 'https://REPLACE_ME_WITH_DEPLOYED_ADMIN_URL';

export const PRIVACY_POLICY_URL = `${ADMIN_DOMAIN}/privacy.html`;
export const ACCOUNT_DELETION_URL = `${ADMIN_DOMAIN}/delete-account.html`;
