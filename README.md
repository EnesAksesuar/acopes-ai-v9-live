# ACOPES AI

**AI Optimization Platform for Etsy Sellers**

[Live demo](https://acopes-ai-v9-live.vercel.app)

ACOPES AI helps Etsy sellers improve listing performance with AI-powered title, tag, SEO, CTR, and draft-safe optimization workflows. The platform connects to Etsy through OAuth, analyzes listing quality, generates conversion-focused recommendations, and keeps every optimization draft-safe so sellers stay in control before anything is approved.

## Key Features

- AI-powered Etsy title and tag optimization
- Draft-safe workflow: nothing publishes without seller approval
- Etsy OAuth 2.0 integration
- SEO scoring engine for CTR, mobile readability, keyword positioning, tags, and confidence
- Jewelry niche optimized for necklaces, bracelets, rings, earrings, minimalist jewelry, and gift-intent searches
- Production-ready deployment on Vercel
- Make.com webhook bridge for AI automation responses
- Admin dashboard protected by `ADMIN_SECRET`

## Tech Stack

- **Backend:** Node.js, Express
- **Frontend:** Vanilla JavaScript, HTML, CSS
- **Deployment:** Vercel
- **Etsy:** Etsy Open API v3, OAuth 2.0
- **AI Workflow:** Claude AI via automation/webhook pipeline
- **Auth:** JWT bearer token fallback plus browser session support
- **Storage:** JSON file storage for beta data

## Quick Start

1. Clone the repository:

```bash
git clone <your-repo-url>
cd <your-repo-folder>
```

2. Install dependencies:

```bash
npm install
```

3. Copy the environment template:

```bash
cp .env.example .env
```

4. Fill in your Etsy, Make, and admin keys in `.env`.

5. Start the local server:

```bash
npm run dev
```

Local app:

```text
http://localhost:4173
```

## Environment Variables

| Variable | Description | Required |
| --- | --- | --- |
| `MAKE_WEBHOOK_URL` | Make.com webhook URL used to send listing optimization requests. | Yes |
| `MAKE_RESPONSE_SECRET` | Shared secret required for Make callback responses. | Yes |
| `PORT` | Local server port. Defaults to `4173`. | No |
| `ETSY_CLIENT_ID` | Etsy app keystring / OAuth client ID. | Yes |
| `ETSY_CLIENT_SECRET` | Etsy app shared secret. | Yes |
| `ETSY_REDIRECT_URI` | OAuth callback URL, for example `/api/etsy/callback`. | Yes |
| `ETSY_SCOPES` | Etsy OAuth scopes, usually `listings_r listings_w shops_r`. | Yes |
| `ETSY_SHOP_NAME` | Optional default Etsy shop name for lookup fallback. | No |
| `ETSY_SHOP_URL` | Optional default Etsy shop URL. | No |
| `SESSION_SECRET` | Secret used for signed sessions and JWT auth tokens. | Yes in production |
| `ADMIN_SECRET` | Secret required to access `/admin.html` stats. | Yes for admin |

## Live Demo

Production URL:

[https://acopes-ai-v9-live.vercel.app](https://acopes-ai-v9-live.vercel.app)

## Screenshots

Add launch screenshots before publishing the repository publicly.

Suggested screenshots:

- Landing page hero
- Etsy connection status
- Listing optimization dashboard
- SEO and confidence score cards
- Admin stats dashboard

```text
docs/screenshots/
```

## Safety Notes

- ACOPES AI is draft-safe by design.
- The app does not auto-publish Etsy listings.
- Keep `.env` out of Git.
- Store production secrets in Vercel environment variables.
- Rotate webhook and OAuth secrets if they are ever exposed.

## License

Private beta project. Add a license before opening the repository publicly.
