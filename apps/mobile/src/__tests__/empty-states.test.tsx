import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { ANONYMITY_NOTICE } from "@/core/constants";
import { mockFetch, renderApp } from "@/testing/helpers";

const mockPush = jest.fn();
let mockParams: Record<string, string> = {};

jest.mock("expo-router", () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn(), replace: jest.fn(), navigate: jest.fn() },
  useLocalSearchParams: () => mockParams,
  Stack: { Screen: () => null, Protected: ({ children }: { children: unknown }) => children },
}));

import FeedScreen from "@/app/(app)/(tabs)/index";
import NotificationsScreen from "@/app/(app)/(tabs)/notifications";
import ProfileScreen from "@/app/(app)/profile/[id]";

const PROFILES = {
  known: { profileId: "prof-me", handle: "jane_doe_4821" },
  anonymous: null,
  anonymousEligibility: { status: "available" },
  notice: ANONYMITY_NOTICE,
};
const empty = { body: { items: [], nextCursor: null } };

beforeEach(() => {
  mockPush.mockClear();
  mockParams = {};
});

describe("feed empty states", () => {
  it("invites the first post when there are none", async () => {
    const f = mockFetch({ "GET /me/profiles": { body: PROFILES }, "GET /feed": empty });
    await renderApp(<FeedScreen />, { fetchImpl: f.impl, identity: true });
    expect(await screen.findByText("No posts yet")).toBeTruthy();
    await fireEvent.press(screen.getAllByRole("button", { name: "Write a post" }).at(-1)!);
    expect(mockPush).toHaveBeenCalledWith("/compose");
  });

  it("sends an empty following tab back to the newest posts", async () => {
    const f = mockFetch({
      "GET /me/profiles": { body: PROFILES },
      "GET /feed": empty,
      "GET /feed/following": empty,
    });
    await renderApp(<FeedScreen />, { fetchImpl: f.impl, identity: true });
    await screen.findByText("No posts yet");
    await fireEvent.press(screen.getByLabelText("Following, 3 of 3"));
    expect(await screen.findByText("Nothing here yet")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "See the newest posts" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Newest, 1 of 3").props.accessibilityState.selected).toBe(true),
    );
  });
});

describe("notifications empty state", () => {
  it("says what will show up here", async () => {
    const f = mockFetch({ "GET /me/profiles": { body: PROFILES }, "GET /notifications": empty });
    await renderApp(<NotificationsScreen />, { fetchImpl: f.impl, identity: true });
    expect(await screen.findByText("No notifications yet")).toBeTruthy();
    expect(screen.getByText("Replies, likes and new followers will show up here.")).toBeTruthy();
  });
});

describe("profile empty state", () => {
  const profile = (over: Record<string, unknown>) => ({
    profileId: "p1",
    kind: "known",
    handle: "jane_doe_4821",
    displayName: "Jane Doe",
    course: null,
    studyYear: null,
    postCount: 0,
    followerCount: 0,
    followingCount: 0,
    viewerFollows: false,
    isSelf: true,
    ...over,
  });

  it("offers your own empty profile a first post", async () => {
    mockParams = { id: "p1" };
    const f = mockFetch({
      "GET /me/profiles": { body: PROFILES },
      "GET /profiles/p1": { body: profile({}) },
      "GET /profiles/p1/posts": empty,
    });
    await renderApp(<ProfileScreen />, { fetchImpl: f.impl, identity: true });
    expect(await screen.findByText("You have not posted yet")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Write a post" }));
    expect(mockPush).toHaveBeenCalledWith("/compose");
  });

  it("shows someone else's empty profile without a button", async () => {
    mockParams = { id: "p2" };
    const f = mockFetch({
      "GET /me/profiles": { body: PROFILES },
      "GET /profiles/p2": { body: profile({ profileId: "p2", isSelf: false }) },
      "GET /profiles/p2/posts": empty,
    });
    await renderApp(<ProfileScreen />, { fetchImpl: f.impl, identity: true });
    expect(await screen.findByText("No posts yet")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Write a post" })).toBeNull();
  });
});
