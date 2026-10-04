# Owner sign-in and authenticated verification

The existing Replit-managed Clerk configuration remains in place. There is no
password, key, token or local-user bypass to configure in application code.

## Owner's one-time action

1. Open the app and choose **Create your account** (`/sign-up`), or **Sign in**
   (`/sign-in`) if you already have an account for this app.
2. Complete the authentication and verification displayed by Clerk. Enter any
   password or verification code only into the app's authentication screen.
3. On the first-time setup screen, check the displayed account and choose
   **Claim workspace as owner**. Claim before sharing the app link.

The claim is authenticated, explicit, audited and serialized in PostgreSQL.
Signing up does not itself grant ownership. Once claimed, all subsequent new
accounts are pending until the owner approves their role in Settings. A second
account cannot claim or overwrite the existing owner. If the account displayed
is wrong, use **Use a different account** before claiming.

If authentication has difficulty inside the embedded preview, use **Open this
page in a new tab** on the sign-in/signup page.

Development and published Clerk accounts are separate. An account created in
the development preview is not automatically an account in the published app.

## Automated verification without claiming the real workspace

Run `pnpm --filter @workspace/api-server run test:auth` for real database-backed
claim and membership tests using transaction-local temporary tables. These
tests do not claim the real workspace or modify its owners/members.

For authenticated browser tests, use Replit's existing Clerk testing helper
`signInClerkUser` inside the browser testing environment with a unique synthetic
account and a short session lifetime. Never expose its sign-in URL or session.
There is no application endpoint that bypasses Clerk or grants a test role.

Until the real owner claims the workspace, browser tests may authenticate and
verify the first-owner screen, pending membership and protected API rejection.
They must **not** click the real claim button as a synthetic account. After
ownership exists, the owner can approve an appropriate test account as Analyst
or Operator using the same in-app member mechanism as any teammate.

Authenticated seller/operator testing uses `/dashboard`, `/leads`, `/calls`,
and the Offers tab on an individual lead. Research belongs to Owner/Analyst;
seller calls and negotiation belong to Owner/Operator; offer approval and
membership administration remain owner-only. Keep synthetic property data
conspicuous and remove only the records created by that test.