import type { FileOrganizerSettings } from "./settings";

/**
 * The wizard opens by itself only for a brand-new install that has never
 * shown or completed onboarding.
 */
export function shouldAutoOpenOnboarding(
  settings: Pick<
    FileOrganizerSettings,
    "hasRunOnboarding" | "hasShownOnboarding"
  >
): boolean {
  return !(settings.hasRunOnboarding || settings.hasShownOnboarding);
}
