# Pi Commerce — Voice AI handoff API

Call this when the onboarding voice AI decides the merchant needs a human (merchant is stuck, asks
for a person, etc.). The merchant is added to the onboarding team's **Request Callback** list and the
onboarder who owns the merchant calls them back.

## Endpoint

```
POST https://pi-commerce-call-center-disposition.vercel.app/api/internal/voice-ai-callback
```

## Headers

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `x-voice-ai-secret` | The secret key shared with you separately. Keep it private. |

## Body (JSON)

Only `phone` is required. Send any other fields you have; **every field you send is stored**, so you
can add new fields later without asking us.

| Field | Required | Example | Notes |
|---|---|---|---|
| `phone` | **Yes** | `"9876543210"` | Merchant's mobile. `+91`, spaces and dashes are fine; the last 10 digits are used. |
| `customer_id` | No | `"1429298799"` | Pi Commerce Cust ID, if you have it. Used first to find the merchant. |
| `call_id` | No | `"call_8f2a…"` | Your call / session ID, for tracing. |
| `reason` | No | `"Stuck at KYC upload"` | Short reason. Shown to the onboarder on the callback request. |
| anything else | No | `"language": "Tamil"`, `"transcript_url": "…"` | Stored as sent. |

## Example

```bash
curl -X POST "https://pi-commerce-call-center-disposition.vercel.app/api/internal/voice-ai-callback" \
  -H "Content-Type: application/json" \
  -H "x-voice-ai-secret: <SECRET>" \
  -d '{"phone":"9876543210","customer_id":"1429298799","call_id":"call_123","reason":"Stuck at KYC upload"}'
```

## Responses

**200 — saved**
```json
{ "ok": true, "request_id": "18234", "matched": true, "customer_id": "1429298799" }
```
- `matched: false` means we could not find the merchant from the phone / customer ID. The request is
  still saved and our team sees it as "unmatched".
- Calling again for the same merchant while their request is still open updates that request
  (no duplicate).

**400 — bad input:** `{ "ok": false, "error": "phone is required (10-digit Indian mobile number)" }`

**401 — wrong or missing secret:** `{ "ok": false, "error": "Unauthorized" }`

A 200 means the handoff is recorded. You can tell the merchant: "Our team will call you back shortly."
