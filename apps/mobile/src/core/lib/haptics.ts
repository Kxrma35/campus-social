import * as Haptics from "expo-haptics";

/** A short tap when a like is added, a lighter tick when it is removed. Never throws. */
export function likeHaptic(liked: boolean): void {
  try {
    void (liked
      ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
      : Haptics.selectionAsync()
    ).catch(() => undefined);
  } catch {
    // Haptics are a nicety, so a device without them is simply silent.
  }
}
