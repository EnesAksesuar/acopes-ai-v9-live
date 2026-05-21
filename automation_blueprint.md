# Edel Luxe Automation Blueprint

## Inputs
- `listing_rewrites.csv`
- Etsy listing export
- Pinterest monthly CSV export
- Weekly Etsy stats export
- Reddit keyword scrape
- Competitor snapshot CSV

## Automations to Run Weekly

### 1. Listing quality review
- Read titles, descriptions, tags, and categories.
- Score against:
  - keyword clarity
  - title length
  - gift-intent coverage
  - image count
  - first-image category
  - conversion asset completeness
- Output:
  - top 10 listings to push
  - listings with duplicate intent
  - listings to prune or rewrite

### 2. Trend monitor
- Watch:
  - `quiet luxury jewelry`
  - `old money necklace`
  - `pearl necklace`
  - `layered gold necklace`
  - `bridesmaid jewelry`
  - `gift for her jewelry`
- Compare weekly movement across:
  - Etsy autocomplete
  - Pinterest trends
  - Reddit mentions

### 3. Competitor watchlist
- Track 10 shops by:
  - featured items
  - price bands
  - first-image style
  - review velocity
  - sale behavior
  - collection depth
- Flag:
  - new bestseller patterns
  - repeated keywords
  - breakout product shapes

### 4. Pinterest generator
- Produce every Monday:
  - 14 product pins
  - 7 styling pins
  - 7 gift-intent pins
- Each pin receives:
  - SEO title
  - 2-sentence description
  - board assignment
  - UTM-tagged listing URL

### 5. Reddit insight loop
- Pull recurring buyer language around:
  - tarnish
  - hypoallergenic
  - daily wear
  - layering
  - pearl styling
  - giftability
- Feed exact phrases into:
  - listing copy
  - FAQ language
  - image text for Pinterest only

## Useful Existing Tooling
- Etsy API command-line tooling can be adapted for listing export and batch checks.
- Local-first analytics dashboards can be reused as the skeleton for competitor snapshots and score trends.

## Next Build Steps
1. Connect Etsy API credentials.
2. Export all live listing fields nightly.
3. Build a local SQLite store for weekly snapshots.
4. Add a simple dashboard:
   - CTR
   - favorites
   - conversion
   - revenue
   - keyword family
   - decision bucket
5. Add Pinterest and competitor import tabs.
