# ACOPES AI Production Checklist

## Environment

- Set `NODE_ENV=production`
- Set `PORT` for the hosting provider
- Set `MAKE_WEBHOOK_URL` in Vercel environment variables
- Keep `.env` local only
- Verify `.env.example` contains placeholders only

## Make / Canva

- Confirm Make scenario is active
- Confirm Make callback points to `/api/make-response`
- Confirm Canva export returns `thumbnail_preview_url`
- Test failed webhook retry behavior

## Paddle

- Replace test upgrade flow with real Paddle checkout
- Add real Paddle webhook verification
- Keep `POST /api/paddle-webhook-test` disabled in production
- Document plan credit mapping

## Domain / DNS

- Confirm Cloudflare DNS points to the production deployment
- Confirm `https://acopesai.com` resolves
- Confirm SSL certificate is active
- Confirm redirects are consistent

## Legal

- Review `/privacy.html`
- Review `/terms.html`
- Add contact email
- Add data retention language before paid launch
- Add billing terms when real Paddle flow is connected

## Analytics / Monitoring

- Add privacy-friendly analytics
- Add server error monitoring
- Add webhook failure alerting
- Add queue failure visibility
- Add uptime check for `/` and `/app.html`

## Launch Assets

- Capture landing hero screenshot
- Capture dashboard KPI screenshot
- Capture competitor intelligence screenshot
- Capture thumbnail intelligence screenshot
- Capture pricing screenshot
- Prepare Product Hunt gallery
