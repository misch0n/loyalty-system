# Wallet integration (production notes)

The prototype **stubs** "Add to Apple/Google Wallet" (`passStub.ts`) because a
static-only frontend cannot issue passes or push updates. This is exactly why
the architecture keeps a Node backend in the production target — the wallet seam
is one of the pieces that genuinely requires a server.

## Apple Wallet (PKPass)

- Generate a signed `.pkpass` bundle server-side (Pass Type ID cert + WWDR cert).
- Stand up a **PassKit web service** so the device can pull updates:
  - `GET /v1/passes/{passTypeId}/{serialNumber}`
  - device registration/unregistration endpoints
  - `GET /v1/devices/{deviceId}/registrations/...` for "what changed"
- Push updates via **APNs** (the pass-update push, not a visible notification).
- Fires when the balance crosses the reward threshold (see `LoyaltyService`).

## Google Wallet

- Create a **Loyalty class** once; issue a **Loyalty object** per customer.
- Add to wallet via a signed **JWT "save" link**.
- Update points by `PATCH`ing the loyalty object through the **Google Wallet REST API**.

## Swap point

Replace `passStub.ts` with a `WalletService` that calls the backend. The card
issuance / accrual flows already surface the wallet action, so only this module
and the backend endpoints change — no UI restructuring.
