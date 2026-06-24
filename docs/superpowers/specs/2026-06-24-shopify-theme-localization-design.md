# Shopify Theme Localization Design

**Goal:** Add storefront language support to the theme using Shopify's recommended localization APIs, auto-select the best language from the visitor's browser context, and expose a manual language switcher in the theme UI.

**Architecture:** Keep the current locale-aware `lang` output and existing translation usage, then add one reusable language switcher snippet and one one-time browser-detection snippet. The switcher will submit Shopify's built-in `localization` form with `language_code`; the detector will query `browsing_context_suggestions.json` and submit the same form only when Shopify recommends a different language and the visitor has not already chosen one.

**Tech Stack:** Shopify Liquid, `form 'localization'`, `localization.available_languages`, `window.Shopify.routes.root`, `browsing_context_suggestions.json`, theme locale JSON files.

---

## References

- [Support multiple currencies and languages](https://shopify.dev/docs/storefronts/themes/markets/multiple-currencies-languages)
- [Detect and set a visitor's optimal localization](https://shopify.dev/docs/storefronts/themes/markets/localization-discovery)
- [Liquid object: localization](https://shopify.dev/docs/api/liquid/objects/localization)
- [Liquid tag: form](https://shopify.dev/docs/api/liquid/tags/form)

## Scope

### In scope

- Manual language switching through Shopify's localization form.
- Automatic language selection from Shopify's browsing-context suggestions.
- Reusable language switcher placement in header, footer, password, and gift card surfaces.
- New locale files for storefront copy and theme editor strings.
- Converting visible demo copy in `sections/hello-world.liquid` to translations.

### Out of scope

- Currency or country switching.
- Merchant-facing localization admin tools.
- Custom geo-IP or browser-language APIs outside Shopify's recommended endpoints.
- Reworking the theme's overall visual language.

## File Plan

- Modify `layout/theme.liquid`
- Modify `layout/password.liquid`
- Modify `templates/gift_card.liquid`
- Modify `sections/header.liquid`
- Modify `sections/footer.liquid`
- Modify `sections/password.liquid`
- Modify `sections/hello-world.liquid`
- Add `snippets/localization-switcher.liquid`
- Add `snippets/localization-detector.liquid`
- Modify `locales/en.default.json`
- Add `locales/zh-CN.json`
- Modify `locales/en.default.schema.json`
- Add `locales/zh-CN.schema.json`

## Behavior

### Manual language switcher

The switcher will only render when `localization.available_languages.size > 1`, matching Shopify's recommendation to hide selectors when there is nothing to switch to. The component will use:

- `form 'localization'`
- `name="language_code"`
- `localization.available_languages`
- `localization.language`

The visible control should use the language endonym for the current label and options. The docs pattern is a disclosure-style control with a button, list of language options, and a hidden `language_code` input; that is the preferred shape here because it matches Shopify's own example and keeps future extensions predictable.

On selection, the snippet will:

- update the hidden `language_code` value
- store the chosen language in `localStorage`
- submit the localization form

If JavaScript fails, the form should still remain usable and the page should not break.

### Automatic browser-language selection

The detector will run once per page load in the top-level layout/template, not inside repeated sections. It will:

- exit immediately when only one language is available
- exit immediately when a preferred language already exists in `localStorage`
- call `window.Shopify.routes.root + 'browsing_context_suggestions.json?language[enabled]=true&language[exclude]=' + window.Shopify.language`
- compare the returned language handle against `localization.available_languages`
- submit a temporary `localization` form with `language_code` only when Shopify returns a different supported language

This follows Shopify's localization-discovery flow instead of reading `navigator.language` directly or hardcoding redirects. The script must fail closed: network errors, missing suggestions, or unsupported locales should result in no-op behavior.

### Placement

- `sections/header.liquid`: render the switcher near the existing utility icons.
- `sections/footer.liquid`: render the switcher near the footer link block.
- `sections/password.liquid`: render the switcher near the password form so the protected storefront can still change language.
- `templates/gift_card.liquid`: render the switcher near the top of the standalone template.
- `layout/theme.liquid`, `layout/password.liquid`, `templates/gift_card.liquid`: render the detector once per page.

### Copy and translations

All visible storefront copy in the demo `hello-world` section will move into locale keys. The theme editor-facing section metadata in that file will also use locale keys, so the section title and preset labels are translated instead of remaining hardcoded English.

The locale work will include:

- `locales/en.default.json` for English storefront strings
- `locales/zh-CN.json` for Chinese storefront strings
- `locales/en.default.schema.json` for editor strings and the section metadata keys
- `locales/zh-CN.schema.json` for the matching translated editor strings

The current schema locale file contains invalid JSON and will be normalized as part of this pass.

## Data Flow

1. Page loads with `request.locale.iso_code` already reflected in `<html lang>`.
2. The detector checks whether the visitor already chose a language.
3. If not, the detector asks Shopify for browsing-context suggestions.
4. If Shopify recommends a different supported language, the detector submits the localization form with that language code.
5. If the visitor manually changes language later, the switcher submits the same form and stores that choice so future visits keep it.
6. Theme copy resolves through `t` keys, so the storefront updates without extra branching in templates.

## Error Handling

- Missing language suggestions: no-op.
- Unsupported language suggestion: no-op.
- Fetch failure: no-op.
- `localStorage` unavailable: manual selection should still work; only preference persistence is lost.
- Single-language store: switcher stays hidden and detector does nothing.

## Validation

- Theme check passes.
- Locale JSON files parse cleanly.
- Header, footer, password, and gift-card surfaces show the switcher only when multiple languages are enabled.
- Visiting with a browser language that maps to a supported locale auto-selects that locale once.
- Manual switching persists and prevents the detector from fighting the user's choice.
- `hello-world` demo copy renders from locale keys in both English and Chinese.

