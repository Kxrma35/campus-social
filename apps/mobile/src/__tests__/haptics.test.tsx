import { fireEvent, render, screen } from "@testing-library/react-native";
import { author, post } from "@/testing/helpers";
import { PostCard } from "@/ui/PostCard";
import { ThemeProvider } from "@/ui/theme";

const mockImpact = jest.fn(async () => undefined);
const mockSelection = jest.fn(async () => undefined);

jest.mock("expo-haptics", () => ({
  impactAsync: (...a: unknown[]) => mockImpact(...(a as [])),
  selectionAsync: () => mockSelection(),
  ImpactFeedbackStyle: { Light: "light" },
}));

const wrap = (ui: React.ReactElement) => render(<ThemeProvider scheme="light">{ui}</ThemeProvider>);

beforeEach(() => {
  mockImpact.mockClear();
  mockSelection.mockClear();
});

describe("like haptics", () => {
  it("taps lightly when a like is added", async () => {
    const toggle = jest.fn();
    await wrap(
      <PostCard post={post({ viewerReacted: false, reactionCount: 1 })} myProfileIds={[]} onToggleReaction={toggle} />,
    );
    await fireEvent.press(screen.getByRole("button", { name: /^Like,/ }));
    expect(mockImpact).toHaveBeenCalledTimes(1);
    expect(mockSelection).not.toHaveBeenCalled();
    expect(toggle).toHaveBeenCalled();
  });

  it("uses a lighter tick when a like is removed", async () => {
    await wrap(
      <PostCard
        post={post({ viewerReacted: true, reactionCount: 2, author: author() })}
        myProfileIds={[]}
        onToggleReaction={jest.fn()}
      />,
    );
    await fireEvent.press(screen.getByRole("button", { name: /^Remove like,/ }));
    expect(mockSelection).toHaveBeenCalledTimes(1);
    expect(mockImpact).not.toHaveBeenCalled();
  });

  it("still likes when the device has no haptics", async () => {
    mockImpact.mockRejectedValueOnce(new Error("no haptics"));
    const toggle = jest.fn();
    await wrap(
      <PostCard post={post({ viewerReacted: false })} myProfileIds={[]} onToggleReaction={toggle} />,
    );
    await fireEvent.press(screen.getByRole("button", { name: /^Like,/ }));
    expect(toggle).toHaveBeenCalled();
  });
});
