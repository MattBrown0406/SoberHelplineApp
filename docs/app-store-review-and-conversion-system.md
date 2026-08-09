# App Store Review and Conversion System

## Automatic rating request

The app uses the native iOS/Android rating sheet. It never asks a user to rate
the app before calling the native sheet and never asks for a positive rating.
The operating system decides whether the sheet is displayed.

Current qualifying moments:

- Completing a seven-day caregiver check-in streak
- Finishing the six core Safety Wallet fields and tapping **Finish for now**
- Returning after at least 10 minutes in the Family Squares support meeting

The request is suppressed when:

- The user is in a crisis flow or the family's current band is `crisis`
- A safety incident was recorded within the previous 72 hours
- The qualifying check-in reports mood or capacity at 1–2, pressure at 4–5,
  or an immediate safety need
- This app version already requested a rating
- A request occurred in the previous 180 days
- Two requests already occurred in the previous 365 days

App Store ratings cannot be tested through TestFlight because iOS reports the
native review action as unavailable there. The Settings **Rate Sober Helpline**
button opens the public App Store review page and can be checked separately.

## Measurement

The app records only the qualifying milestone and app version. It never places
check-in answers, notes, incident details, names, or other family content in the
review analytics event.

The admin screen reports:

- Eligible moments
- Native review requests made
- Unique accounts requested
- User-initiated App Store review-page opens
- The same request/open counts for the last 30 days

Apple does not reveal whether its sheet appeared or what rating a user chose.
Compare the admin request trend with rating volume and average rating in App
Store Connect once a week.

## Product Page Optimization test

Run one hypothesis at a time and keep each treatment live until it has enough
impressions to make a decision. Do not change the binary during a test unless a
release is necessary.

### First test: first three screenshots

Control: current screenshots.

Treatment A — daily guidance:

1. **A daily plan for families facing addiction**
2. **Practice the hard conversation before it happens**
3. **Know your next safe step in a crisis**

Treatment B — caregiver transformation:

1. **Move from panic to a clear next step**
2. **Set boundaries you can actually hold**
3. **Support for active addiction and early recovery**

Primary metric: product-page conversion rate. Guardrail: seven-day check-in
activation among new downloads, so a high-converting treatment does not attract
the wrong audience.

### Second test: app icon

Test the current lighthouse against one simpler, higher-contrast lighthouse
that remains recognizable at small sizes. Keep the name and screenshot
treatment unchanged during the icon test.

### Storefront fixes before paid acquisition

- Complete the App Privacy questionnaire based on the actual account, cloud,
  purchase, message, and product-interaction data used by the app.
- Confirm Spanish is declared as a supported localization and publish Spanish
  screenshots.
- Update the first screenshot in English and Spanish with an outcome-focused
  headline.
- Confirm the 3.6 description mentions AI Conversation Practice and the free
  Family Squares Monday Night Support Meeting.
