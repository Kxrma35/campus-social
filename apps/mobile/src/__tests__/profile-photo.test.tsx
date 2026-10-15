import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { mockFetch, renderApp } from "@/testing/helpers";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({}),
  Stack: { Screen: () => null, Protected: ({ children }: { children: unknown }) => children },
}));
jest.mock("@/core/photos", () => ({ pickAndUpload: jest.fn(async () => []) }));
import { pickAndUpload } from "@/core/photos";

import EditProfile from "@/app/(app)/settings/edit-profile";
import Done from "@/app/(auth)/done";
import { Avatar } from "@/ui/Avatar";

const SESSION = {
  sessionToken: "tok_new",
  expiresAt: "2027-01-01T00:00:00Z",
  account: { id: "a1", status: "active" as const },
  profile: { id: "p1" },
};
const DETAILS = {
  profileId: "prof-me",
  handle: "jane_doe_4821",
  displayName: "Jane Doe",
  course: null,
  studyYear: null,
  hasAvatar: false,
};

beforeEach(() => {
  mockPush.mockClear();
  jest.clearAllMocks();
});

describe("Avatar photo", () => {
  it("shows initials when there is no photo", async () => {
    await renderApp(<Avatar kind="known" name="Jane Doe" profileId="p1" hasAvatar={false} />, { token: "t" });
    expect(screen.getByText("J", { includeHiddenElements: true })).toBeTruthy();
  });

  it("loads the photo with the session header from the profile path", async () => {
    await renderApp(<Avatar kind="known" name="Jane Doe" profileId="p1" hasAvatar />, { token: "tok_abc" });
    const img = screen.getByTestId("avatar-photo", { includeHiddenElements: true });
    expect(img.props.source.uri).toBe("https://api.test/profiles/p1/avatar");
    expect(img.props.source.headers.authorization).toBe("Bearer tok_abc");
    expect(screen.queryByText("J", { includeHiddenElements: true })).toBeNull();
  });

  it("never shows a photo for an anonymous profile, even if told to", async () => {
    await renderApp(<Avatar kind="anonymous" name="quiet_fox_1234" profileId="p9" hasAvatar />, { token: "t" });
    expect(screen.queryByTestId("avatar-photo", { includeHiddenElements: true })).toBeNull();
  });

  it("falls back to the initial when the photo fails to load", async () => {
    await renderApp(<Avatar kind="known" name="Jane Doe" profileId="p1" hasAvatar />, { token: "t" });
    await act(async () => {
      screen.getByTestId("avatar-photo", { includeHiddenElements: true }).props.onError();
    });
    expect(screen.getByText("J", { includeHiddenElements: true })).toBeTruthy();
  });
});

describe("edit profile photo", () => {
  it("adds a photo in two steps: upload, then attach", async () => {
    (pickAndUpload as jest.Mock).mockResolvedValueOnce([
      { localUri: "file:///p.jpg", uploadId: "up-1", width: 10, height: 10 },
    ]);
    const f = mockFetch({
      "GET /me/profile": { body: DETAILS },
      "PUT /me/avatar": { body: { ok: true } },
    });
    await renderApp(<EditProfile />, { fetchImpl: f.impl });
    await screen.findByDisplayValue("Jane Doe");

    await act(async () => {
      await fireEvent.press(screen.getByRole("button", { name: "Choose a photo" }));
    });

    await waitFor(() => expect(f.calls.some((c) => c.path === "/me/avatar")).toBe(true));
    const call = f.calls.find((c) => c.path === "/me/avatar")!;
    expect(call).toMatchObject({ method: "PUT", body: { photoId: "up-1" } });
    expect(await screen.findByRole("button", { name: "Remove photo" })).toBeTruthy();
  });

  it("removes a photo", async () => {
    const f = mockFetch({
      "GET /me/profile": { body: { ...DETAILS, hasAvatar: true } },
      "DELETE /me/avatar": { body: { ok: true } },
    });
    await renderApp(<EditProfile />, { fetchImpl: f.impl });
    await screen.findByDisplayValue("Jane Doe");
    await act(async () => {
      await fireEvent.press(screen.getByRole("button", { name: "Remove photo" }));
    });
    await waitFor(() => expect(f.calls.some((c) => c.method === "DELETE")).toBe(true));
    expect(await screen.findByRole("button", { name: "Choose a photo" })).toBeTruthy();
  });

  it("tells students who can see it and that anonymous never has one", async () => {
    const f = mockFetch({ "GET /me/profile": { body: DETAILS } });
    await renderApp(<EditProfile />, { fetchImpl: f.impl });
    expect(await screen.findByText(/Other verified students at your campus can see this photo/)).toBeTruthy();
    expect(screen.getByText(/Your anonymous profile never has one/)).toBeTruthy();
  });

  it("explains an unsupported image and keeps the old state", async () => {
    (pickAndUpload as jest.Mock).mockRejectedValueOnce(new Error("unsupported_image_type"));
    const f = mockFetch({ "GET /me/profile": { body: DETAILS } });
    await renderApp(<EditProfile />, { fetchImpl: f.impl });
    await screen.findByDisplayValue("Jane Doe");
    await act(async () => {
      await fireEvent.press(screen.getByRole("button", { name: "Choose a photo" }));
    });
    expect(await screen.findByText("Use a JPEG, PNG or WebP photo.")).toBeTruthy();
    expect(f.calls.some((c) => c.path === "/me/avatar")).toBe(false);
  });
});

describe("sign-up photo step", () => {
  it("offers a photo or opening without one, and signs in either way", async () => {
    jest.useFakeTimers();
    try {
      await renderApp(<Done />, {
        fetchImpl: mockFetch({}).impl,
        token: null,
        authFlow: { pendingSession: SESSION },
      });
      expect(screen.getByText(/optional/)).toBeTruthy();
      expect(screen.getByRole("button", { name: /without a photo/ })).toBeTruthy();
      await act(async () => {
        await fireEvent.press(screen.getByRole("button", { name: "Add a profile photo" }));
      });
      await act(async () => {
        jest.advanceTimersByTime(400);
      });
      expect(mockPush).toHaveBeenCalledWith("/settings/edit-profile");
    } finally {
      jest.useRealTimers();
    }
  });

  it("does not open the photo screen when skipped", async () => {
    await renderApp(<Done />, {
      fetchImpl: mockFetch({}).impl,
      token: null,
      authFlow: { pendingSession: SESSION },
    });
    await act(async () => {
      await fireEvent.press(screen.getByRole("button", { name: /without a photo/ }));
    });
    expect(mockPush).not.toHaveBeenCalled();
  });
});
