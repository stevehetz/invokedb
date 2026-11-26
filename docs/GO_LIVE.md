# Going live: the business behind paid plans

_Started 2026-11-26._

Paid plans (#129, PR #310) are built and work end to end in the Stripe **sandbox**. Taking real
money needs a legal business with a bank account, verified in Stripe's live mode. This file
tracks the owner's steps to get there, in order. Tick each box when it's done.

The repo is public: keep personal and legal details (names, addresses, ID and account numbers,
the lawyer's contact) out of this file and in the owner's own records.

## Where it stands

- The original Ohio LLC (formed 2020) was **dissolved on purpose in 2021**, and its bank account
  is closed. A dissolved LLC can't be reused, so a **new LLC** is formed. Going live as a sole
  proprietor was ruled out (personal liability).
- The **InvokeDB trademark** was registered about five years ago through the owner's lawyer. Its
  renewal (the Section 8 declaration of use) is due by **April 2027**; the lawyer has asked
  whether to file it and for specimens of use.
- The Stripe **sandbox** account "InvokeDB" is set up: the four prices by lookup key, the Customer
  Portal, failed-payment retries (`docs/OPERATIONS.md`, "Stripe"). The live account is not
  verified yet.

## Steps

### 1. Talk to the lawyer

- [ ] Decide who forms the new LLC: the lawyer, or the owner online (step 2).
- [ ] Ask the lawyer to update the old **operating agreement** for the new LLC.

### 2. Form the new LLC

- [ ] File Articles of Organization for **InvokeDB, LLC** with the Ohio Secretary of State
      (ohiobusinesscentral.gov; a one-time filing fee, no annual report or fee in Ohio). Name a
      statutory agent with an Ohio address.
- [ ] Keep the filed Articles (PDF) and the new entity number in the owner's records.

### 3. Get an EIN

- [ ] Apply on irs.gov ("Apply for an EIN online"; free, issued at once). It's a new EIN: the
      old one belongs to the dissolved LLC.
- [ ] Keep the EIN confirmation letter (CP 575).

### 4. Operating agreement

- [ ] Signed operating agreement for the new LLC (from step 1).

### 5. Business bank account

- [ ] Open a business checking account in the LLC's name. Banks usually want the EIN, the
      Articles, the operating agreement and the owner's ID (some ask for a certificate of good
      standing, sold on the Ohio SOS business search).

### 6. Stripe live mode

- [ ] **Verify your business** in the InvokeDB Stripe account: the LLC's legal name and EIN, the
      owner as representative, the business bank account for payouts, statement descriptor
      `INVOKEDB`.
- [ ] Repeat the sandbox setup in live mode (`docs/OPERATIONS.md`, "Stripe", steps 1–5): the two
      products and four prices with their lookup keys, the Customer Portal, failed-payment
      retries, the webhook endpoint `https://<API_DOMAIN>/billing/webhook`.
- [ ] Live `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` into `deploy/prod.env`
      (`deploy.sh env`), redeploy, and buy one real plan to check (then refund it in Stripe).
- [ ] Decide on sales tax: Stripe Tax, Stripe's Managed Payments (merchant of record, +3.5%), or
      neither for now (skipped at sandbox setup).

### 7. The site

- [ ] Update the Terms and Privacy pages' company name and address for the new LLC (an issue
      when the LLC exists).

### 8. Trademark (last; renewal due by April 2027)

- [ ] Reply to the lawyer's renewal email: yes, renew.
- [ ] Ask **who owns the trademark**. If it's the dissolved LLC, it needs assigning (to the new
      LLC, ideally) and the assignment recorded at the USPTO before the renewal can be filed.
- [ ] Send the specimens of use: JPEG screenshots of invokedb.com showing the InvokeDB name and
      logo in commerce (home page, pricing page with the paid plans, the app). Claude can take
      them.
- [ ] Renewal filed by the lawyer.
