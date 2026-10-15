import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { ANONYMITY_NOTICE } from "@/core/constants";
import { mockFetch, post, renderApp } from "@/testing/helpers";

const mockBack = jest.fn();

jest.mock("expo-router", () => ({
  router: { back: () => mockBack(), push: jest.fn(), replace: jest.fn(), dismissAll: jest.fn() },
  useLocalSearchParams: () => ({}),
  Stack: { Screen: () => null, Protected: ({ children }: { children: unknown }) => children },
}));
jest.mock("@/core/photos", () => ({ pickAndUpload: jest.fn(async () => []) }));
import { pickAndUpload } from "@/core/photos";

import ComposeScreen from "@/app/(app)/compose";

const WITH_ANON = {
  known: { profileId: "prof-me", handle: "jane_doe_4821" },
  anonymous: { profileId: "prof-anon", handle: "quiet_fox_1234", avatarKey: "gen:1:2" },
  anonymousEligibility: { status: "exists" },
  notice: ANONYMITY_NOTICE,
};

const picked = [{ localUri: "file:///p.jpg", uploadId: "up-0", width: 10, height: 10 }];

beforeEach(() => {
  mockBack.mockClear();
  jest.clearAllMocks();
});

describe("posting-as switch", () => {
  it("is a labelled radio group that starts on the known profile", async () => {
    const f = mockFetch({ "GET /me/profiles": { body: WITH_ANON } });
    await renderApp(<ComposeScreen />, { fetchImpl: f.impl, identity: true });

    const group = await screen.findByLabelText("Post as");
    expect(group.props.accessibilityRole).toBe("radiogroup");
    const known = screen.getByRole("radio", { name: /^You\./ });
    const anon = screen.getByRole("radio", { name: /^Anonymous\./ });
    expect(known.props.accessibilityState.checked).toBe(true);
    expect(anon.props.accessibilityState.checked).toBe(false);
    expect(screen.getByText("Hidden from other students")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Post" })).toBeTruthy();
  });

  it("switches identity with the words changing too, not just colour", async () => {
    const f = mockFetch({ "GET /me/profiles": { body: WITH_ANON } });
    await renderApp(<ComposeScreen />, { fetchImpl: f.impl, identity: true });
    await fireEvent.press(await screen.findByTestId("as-anonymous"));

    expect(screen.getByRole("radio", { name: /^Anonymous\./ }).props.accessibilityState.checked).toBe(true);
    expect(screen.getByText("Posting as anonymous")).toBeTruthy();
    expect(screen.getByText(/only @quiet_fox_1234, not your name/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Post anonymously" })).toBeTruthy();

    await fireEvent.press(screen.getByTestId("as-known"));
    expect(screen.getByText("Posting as you")).toBeTruthy();
  });

  it("asks before dropping photos, and keeps them when told to", async () => {
    (pickAndUpload as jest.Mock).mockResolvedValueOnce(picked);
    const f = mockFetch({ "GET /me/profiles": { body: WITH_ANON } });
    await renderApp(<ComposeScreen />, { fetchImpl: f.impl, identity: true });
    await screen.findByTestId("as-anonymous");
    await act(async () => {
      await fireEvent.press(screen.getByRole("button", { name: /Add photos/ }));
    });
    expect(screen.getByLabelText("Remove photo 1")).toBeTruthy();

    await fireEvent.press(screen.getByTestId("as-anonymous"));
    expect(screen.getByText("Switch profile?")).toBeTruthy();
    expect(screen.getByText("Posting as you")).toBeTruthy();

    await fireEvent.press(screen.getByTestId("cancel-switch"));
    expect(screen.queryByText("Switch profile?")).toBeNull();
    expect(screen.getByText("Posting as you")).toBeTruthy();
    expect(screen.getByLabelText("Remove photo 1")).toBeTruthy();
  });

  it("removes the photos only after the switch is confirmed", async () => {
    (pickAndUpload as jest.Mock).mockResolvedValueOnce(picked);
    const f = mockFetch({
      "GET /me/profiles": { body: WITH_ANON },
      "POST /posts": { status: 201, body: post() },
    });
    await renderApp(<ComposeScreen />, { fetchImpl: f.impl, identity: true });
    await screen.findByTestId("as-anonymous");
    await act(async () => {
      await fireEvent.press(screen.getByRole("button", { name: /Add photos/ }));
    });

    await fireEvent.press(screen.getByTestId("as-anonymous"));
    await fireEvent.press(screen.getByTestId("confirm-switch"));

    expect(screen.getByText("Posting as anonymous")).toBeTruthy();
    expect(screen.queryByLabelText("Remove photo 1")).toBeNull();
    expect(screen.queryByText("Switch profile?")).toBeNull();
  });

  it("switches straight away when there are no photos to lose", async () => {
    const f = mockFetch({ "GET /me/profiles": { body: WITH_ANON } });
    await renderApp(<ComposeScreen />, { fetchImpl: f.impl, identity: true });
    await fireEvent.press(await screen.findByTestId("as-anonymous"));
    expect(screen.queryByText("Switch profile?")).toBeNull();
    await waitFor(() => expect(screen.getByText("Posting as anonymous")).toBeTruthy());
  });

  it("is not shown without an anonymous profile", async () => {
    const f = mockFetch({
      "GET /me/profiles": { body: { ...WITH_ANON, anonymous: null, anonymousEligibility: { status: "available" } } },
    });
    await renderApp(<ComposeScreen />, { fetchImpl: f.impl, identity: true });
    expect(await screen.findByText("Posting as you")).toBeTruthy();
    expect(screen.queryByLabelText("Post as")).toBeNull();
  });
});
