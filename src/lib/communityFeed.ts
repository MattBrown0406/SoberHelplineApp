/**
 * The community feed (app/community.tsx) is hidden while membership is small:
 * an empty feed reads as an abandoned app, and it is the app's riskiest
 * screen (member posts that can describe a crisis). The code, moderation and
 * crisis screening stay in place; set this to true to bring it back.
 */
export const COMMUNITY_FEED_VISIBLE = false;
