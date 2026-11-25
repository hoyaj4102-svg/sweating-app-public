# SWEATING home (Phase 1) design notes
Tokens: `src/explore/home-brand.css`, scoped to `.home-v1` (home only; other pages untouched).
- Palette (70/20/10): ivory #F7F5EF base, charcoal #202522 text/active, sage #87917C + mint #C8D5CA status/selected, dusty peach #D8B6A3 reserved for Like/Match (unused on home).
- Type: Inter for Latin and Noto Sans KR for Korean (Google Fonts); installed Pretendard and system fonts are fallbacks. Font styling is home-scoped.
- Shape: cards 20px, buttons 14px, pill filters, 1px low-contrast borders, quiet shadows, line icons (lucide), no emoji.
- Slogan: MOVE MORE. MEET BETTER. / 움직여야, 좋은 사람을 만난다. (Current Phase 2 brief supersedes the earlier English slogan; home layout is unchanged.)
- Region label "예시시·샘플 지역" is a demo label, not geolocation. 헬스 maps to API value 근력 운동.
- Map mode is an honest placeholder (real map/place work is not approved). Filters are client-side over loaded classes; state lives in URL (sport, q, view, open, free); detail back uses allowlisted `back=/home?...`.

## Current Phase 2 — class detail
- The newest brief defines Phase 2 as class-detail UX, not the earlier proposed map/place phase. Real maps remain outside scope.
- Detail tokens live in `src/explore/detail-brand.css`, scoped to `.dt-v1`, mirroring the home palette and typography without changing home layout.
- Mobile uses a fixed price/remaining/action bar; desktop uses a sticky right-hand action card.
- Tier, difficulty, beginner guidance and policy examples are sample-only. Real metadata that is absent stays explicitly unavailable.
- Sample state previews do not change bookings, participant counts or sessions. Signup and OAuth remain unchanged; only the email-login return destination is connected.

## Visual First Sprint v2
- Official auxiliary slogan: **MOVE TO MEET.** (latest approved copy).
- `/`: **움직여야, 좋은 사람을 만난다.**
- `/about`: **소개팅 말고, 같이 운동할래요?**
- `/home`: **오늘, 누구와 함께 운동할까요?**
- `/partners`: **체육관의 빈 시간을 새로운 매출 기회로.**
- About/partners reuse root orange; home/detail colors and existing filters stay unchanged. New scoped UI is in `src/visual-v2/`.
- Marketing UTM values are bounded, allowlisted and encoded; existing internal return validators are not relaxed.
- Partner form is validation-only, with no server/storage/contact submission. `/start` preserves the original `/signup` and `/login`.
- SWM preview is DEV-only and fictional, with in-memory balances, no actual participant data and no API calls. Before workout identities stay hidden; free mutual Matches are excluded from paid reveal.
