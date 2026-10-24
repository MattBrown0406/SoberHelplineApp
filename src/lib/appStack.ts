type StackState = { key?: string; type?: string; index?: number; routes: readonly { state?: StackState }[] };
type StackRef = {
  isReady(): boolean;
  getRootState(): StackState | undefined;
  dispatch(action: { type: string; target?: string }): void;
};

/**
 * A REPLACE swaps only the top screen of the app's stack. Crossing into or out
 * of the signed-in app, first drop screens stacked above the first (e.g.
 * Settings), or the previous account's tabs stay mounted underneath the new
 * ones. expo-router nests app/_layout's Stack under its own `__root` route.
 */
export function collapseAppStack(navigationRef: StackRef): void {
  if (!navigationRef.isReady()) return;
  const root = navigationRef.getRootState();
  const app = root?.routes[root.index ?? 0]?.state;
  if (app?.type === 'stack' && app.key && app.routes.length > 1) {
    navigationRef.dispatch({ type: 'POP_TO_TOP', target: app.key });
  }
}
