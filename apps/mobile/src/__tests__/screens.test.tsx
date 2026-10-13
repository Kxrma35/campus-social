import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { ANONYMITY_NOTICE } from "@/core/constants";
import { author, mockFetch, post, renderApp } from "@/testing/helpers";

const mockBack = jest.fn();
const mockPush = jest.fn();
let mockParams: Record<string, string> = {};

jest.mock("expo-router", () => ({
  router: {
    back: () => mockBack(),
    push: (...a: unknown[]) => mockPush(...a),
    dismissAll: jest.fn(),
    replace: jest.fn(),
  },
  useLocalSearchParams: () => mockParams,
  Stack: { Screen: () => null, Protected: ({ children }: { children: unknown }) => children },
  Tabs: { Screen: () => null },
}));

jest.mock("@/core/exportFile", () => ({
  shareJson: jest.fn(async () => "shared"),
}));
jest.mock("@/core/photos", () => ({
  pickAndUpload: jest.fn(async () => []),
}));
import { pickAndUpload } from "@/core/photos";

import ComposeScreen from "@/app/(app)/compose";
import AnonymousSettings from "@/app/(app)/settings/anonymous";
import DataScreen from "@/app/(app)/settings/data";
import EditProfile from "@/app/(app)/settings/edit-profile";
import FeedScreen from "@/app/(app)/(tabs)/index";
import ReportScreen from "@/app/(app)/report";
import { shareJson } from "@/core/exportFile";

const MY_PROFILES_NO_ANON = {
  known: { profileId: "prof-me", handle: "jane_doe_4821" },
  anonymous: null,
  anonymousEligibility: { status: "available" },
  notice: ANONYMITY_NOTICE,
};
const MY_PROFILES_WITH_ANON = {
  ...MY_PROFILES_NO_ANON,
  anonymous: { profileId: "prof-anon", handle: "quiet_fox_1234", avatarKey: "gen:1:2" },
  anonymousEligibility: { status: "exists" },
};

beforeEach(() => {
  mockBack.mockClear();
  mockPush.mockClear();
  mockParams = {};
  jest.clearAllMocks();
});

describe("composer", () => {
  it("starts as the known profile and offers no anonymous option without one", async () => {
    const f = mockFetch({ "GET /me/profiles": { body: MY_PROFILES_NO_ANON } });
    await renderApp(<ComposeScreen />, { fetchImpl: f.impl, identity: true });
    expect(await screen.findByText("Posting as you")).toBeTruthy();
    expect(screen.queryByTestId("switch-profile")).toBeNull();
    expect(screen.getByText(/will see your name/)).toBeTruthy();
  });

  it("sends nothing for an empty post", async () => {
    const f = mockFetch({ "GET /me/profiles": { body: MY_PROFILES_NO_ANON } });
    await renderApp(<ComposeScreen />, { fetchImpl: f.impl, identity: true });
    await fireEvent.press(screen.getByTestId("send-post"));
    expect(await screen.findByText("Write something or add a photo.")).toBeTruthy();
    expect(f.calls.filter((c) => c.path === "/posts")).toHaveLength(0);
  });

  it("posts as the known profile with no acting-as header and goes back", async () => {
    const f = mockFetch({
      "GET /me/profiles": { body: MY_PROFILES_NO_ANON },
      "POST /posts": { status: 201, body: post() },
    });
    await renderApp(<ComposeScreen />, { fetchImpl: f.impl, identity: true });
    await fireEvent.changeText(screen.getByTestId("post-body"), "  Hello campus  ");
    await act(async () => {
      await fireEvent.press(screen.getByTestId("send-post"));
    });
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    const sent = f.calls.find((c) => c.path === "/posts")!;
    expect(sent.body).toEqual({ body: "Hello campus", photoIds: [] });
    expect(sent.headers["x-acting-as"]).toBeUndefined();
  });

  it("makes anonymous posting explicit, then confirms when the server asks", async () => {
    let calls = 0;
    const f = mockFetch({ "GET /me/profiles": { body: MY_PROFILES_WITH_ANON } });
    const impl = (async (url: string, init: RequestInit) => {
      if ((init.method ?? "GET") === "POST" && url.endsWith("/posts")) {
        calls += 1;
        const body = JSON.parse(init.body as string);
        if (!body.confirmedAnonymous) {
          return {
            status: 409,
            ok: false,
            text: async () =>
              JSON.stringify({ error: "confirmation_required", message: "Confirm that you want to post anonymously." }),
          } as unknown as Response;
        }
        return {
          status: 201,
          ok: true,
          text: async () =>
            JSON.stringify(post({ author: author({ kind: "anonymous", handle: "quiet_fox_1234", displayName: null }) })),
        } as unknown as Response;
      }
      return f.impl(url, init);
    }) as unknown as typeof fetch;

    await renderApp(<ComposeScreen />, { fetchImpl: impl, identity: true });
    await fireEvent.press(await screen.findByTestId("switch-profile"));

    expect(await screen.findByText("Posting as anonymous")).toBeTruthy();
    expect(screen.getByText(/only @quiet_fox_1234, not your name/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Post anonymously" })).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId("post-body"), "a quiet thought");
    await act(async () => {
      await fireEvent.press(screen.getByTestId("send-post"));
    });

    expect(await screen.findByText(ANONYMITY_NOTICE)).toBeTruthy();
    expect(mockBack).not.toHaveBeenCalled();

    await act(async () => {
      await fireEvent.press(screen.getByTestId("confirm-anonymous"));
    });
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(calls).toBe(2);
  });

  it("explains a read-only account in words", async () => {
    const f = mockFetch({
      "GET /me/profiles": { body: MY_PROFILES_NO_ANON },
      "POST /posts": { status: 403, body: { error: "read_only", message: "x" } },
    });
    await renderApp(<ComposeScreen />, { fetchImpl: f.impl, identity: true });
    await fireEvent.changeText(screen.getByTestId("post-body"), "hello");
    await act(async () => {
      await fireEvent.press(screen.getByTestId("send-post"));
    });
    expect(await screen.findByText(/read-only until you re-verify/)).toBeTruthy();
    expect(mockBack).not.toHaveBeenCalled();
  });

  it("shows support information after a flagged post, and never invents a number", async () => {
    const f = mockFetch({
      "GET /me/profiles": { body: MY_PROFILES_NO_ANON },
      "POST /posts": {
        status: 201,
        body: post({ support: { message: "You do not have to face this alone.", resources: [] } }),
      },
    });
    await renderApp(<ComposeScreen />, { fetchImpl: f.impl, identity: true });
    await fireEvent.changeText(screen.getByTestId("post-body"), "i feel awful");
    await act(async () => {
      await fireEvent.press(screen.getByTestId("send-post"));
    });
    expect(await screen.findByText("You do not have to face this alone.")).toBeTruthy();
    expect(screen.getByText(/local emergency services/)).toBeTruthy();
    expect(screen.queryByText(/\+?\d{6,}/)).toBeNull();
    expect(mockBack).not.toHaveBeenCalled();
  });
});

describe("composer photo descriptions", () => {
  const picked = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      localUri: `file:///p${i}.jpg`,
      uploadId: `up-${i}`,
      width: 10,
      height: 10,
    }));

  it("sends cleaned descriptions only for photos that have one", async () => {
    (pickAndUpload as jest.Mock).mockResolvedValueOnce(picked(2));
    const f = mockFetch({
      "GET /me/profiles": { body: MY_PROFILES_NO_ANON },
      "POST /posts": { status: 201, body: post() },
    });
    await renderApp(<ComposeScreen />, { fetchImpl: f.impl, identity: true });
    await screen.findByText("Posting as you");
    await act(async () => {
      await fireEvent.press(screen.getByRole("button", { name: /Add photos/ }));
    });

    await fireEvent.changeText(screen.getByTestId("alt-0"), "  A   red bicycle ");
    await act(async () => {
      await fireEvent.press(screen.getByTestId("send-post"));
    });
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    const sent = f.calls.find((c) => c.path === "/posts")!;
    expect(sent.body).toEqual({
      body: "",
      photoIds: ["up-0", "up-1"],
      altTexts: { "up-0": "A red bicycle" },
    });
  });

  it("labels each description field and shows no anonymity warning on a known profile", async () => {
    (pickAndUpload as jest.Mock).mockResolvedValueOnce(picked(1));
    const f = mockFetch({ "GET /me/profiles": { body: MY_PROFILES_NO_ANON } });
    await renderApp(<ComposeScreen />, { fetchImpl: f.impl, identity: true });
    await screen.findByText("Posting as you");
    await act(async () => {
      await fireEvent.press(screen.getByRole("button", { name: /Add photos/ }));
    });
    expect(screen.getByText("Describe photo 1 (optional)")).toBeTruthy();
    expect(screen.getByText(/for people who use a screen reader/)).toBeTruthy();
    expect(screen.queryByText(/could identify you/)).toBeNull();
  });

  it("drops a description when its photo is removed", async () => {
    (pickAndUpload as jest.Mock).mockResolvedValueOnce(picked(2));
    const f = mockFetch({
      "GET /me/profiles": { body: MY_PROFILES_NO_ANON },
      "POST /posts": { status: 201, body: post() },
    });
    await renderApp(<ComposeScreen />, { fetchImpl: f.impl, identity: true });
    await screen.findByText("Posting as you");
    await act(async () => {
      await fireEvent.press(screen.getByRole("button", { name: /Add photos/ }));
    });
    await fireEvent.changeText(screen.getByTestId("alt-0"), "will be removed");
    await fireEvent.press(screen.getByLabelText("Remove photo 1"));
    await act(async () => {
      await fireEvent.press(screen.getByTestId("send-post"));
    });
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(f.calls.find((c) => c.path === "/posts")!.body).toEqual({ body: "", photoIds: ["up-1"] });
  });
});

describe("anonymous profile settings", () => {
  it("will not create the profile until the notice has been acknowledged", async () => {
    const f = mockFetch({
      "GET /me/profiles": { body: MY_PROFILES_NO_ANON },
      "POST /profiles/anonymous": {
        status: 201,
        body: { profile: { profileId: "x", handle: "quiet_fox_1234", avatarKey: "gen:1:2" }, notice: ANONYMITY_NOTICE },
      },
    });
    await renderApp(<AnonymousSettings />, { fetchImpl: f.impl, identity: true });
    expect(await screen.findByText(ANONYMITY_NOTICE)).toBeTruthy();

    const create = screen.getByTestId("create-anon");
    expect(create.props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(create);
    expect(f.calls.filter((c) => c.path === "/profiles/anonymous")).toHaveLength(0);

    expect(screen.getByTestId("read-notice").props.accessibilityState.checked).toBe(false);
    await fireEvent.press(screen.getByTestId("read-notice"));
    await act(async () => {
      await fireEvent.press(screen.getByTestId("create-anon"));
    });
    await waitFor(() =>
      expect(f.calls.filter((c) => c.path === "/profiles/anonymous")).toHaveLength(1),
    );
  });

  it.each([
    ["locked_new_account", /unlock when your account is a few days old/],
    ["locked_strikes", /while your account has a warning/],
    ["locked_account_state", /unavailable for your account right now/],
    ["unavailable", /temporarily unavailable/],
  ] as [string, RegExp][])("says why it is locked: %s", async (status, pattern) => {
    const f = mockFetch({
      "GET /me/profiles": {
        body: { ...MY_PROFILES_NO_ANON, anonymousEligibility: { status, unlocksAt: "2026-10-15T10:00:00.000Z" } },
      },
    });
    await renderApp(<AnonymousSettings />, { fetchImpl: f.impl, identity: true });
    expect(await screen.findByText(pattern)).toBeTruthy();
    expect(screen.queryByTestId("create-anon")).toBeNull();
  });

  it("shows the existing profile and the honest limits", async () => {
    const f = mockFetch({ "GET /me/profiles": { body: MY_PROFILES_WITH_ANON } });
    await renderApp(<AnonymousSettings />, { fetchImpl: f.impl, identity: true });
    expect(await screen.findByText("@quiet_fox_1234")).toBeTruthy();
    expect(screen.getByText(/cannot stop a screenshot/)).toBeTruthy();
  });
});

describe("your data", () => {
  it("downloads and shares the export", async () => {
    const f = mockFetch({ "GET /account/export": { body: { schemaVersion: 2, account: {} } } });
    await renderApp(<DataScreen />, { fetchImpl: f.impl, identity: true });
    await act(async () => {
      await fireEvent.press(screen.getByTestId("download-data"));
    });
    await waitFor(() => expect(shareJson).toHaveBeenCalledTimes(1));
    expect((shareJson as jest.Mock).mock.calls[0]![1]).toEqual({ schemaVersion: 2, account: {} });
    expect(await screen.findByText(/Keep the file private/)).toBeTruthy();
  });

  it("warns that the file links the two profiles", async () => {
    await renderApp(<DataScreen />, { fetchImpl: mockFetch({}).impl, identity: true });
    expect(screen.getByText(/connects it to your known profile/)).toBeTruthy();
  });

  it("will not ask for a closing code until the person has said they understand", async () => {
    const f = mockFetch({});
    await renderApp(<DataScreen />, { fetchImpl: f.impl, identity: true });
    const request = screen.getByTestId("request-close");
    expect(request.props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(request);
    expect(f.calls.filter((c) => c.path.startsWith("/account/close"))).toHaveLength(0);
  });

  it("closes the account with a code and signs out", async () => {
    const f = mockFetch({
      "POST /account/close/request": { status: 202, body: { status: "code_sent" } },
      "POST /account/close/confirm": { status: 204 },
      "POST /auth/logout": { status: 204 },
    });
    await renderApp(<DataScreen />, { fetchImpl: f.impl, identity: true });

    await fireEvent.press(screen.getByTestId("understand-close"));
    await act(async () => {
      await fireEvent.press(screen.getByTestId("request-close"));
    });
    await waitFor(() => expect(screen.getByTestId("close-code")).toBeTruthy());

    await fireEvent.changeText(screen.getByTestId("close-code"), "123456");
    await act(async () => {
      await fireEvent.press(screen.getByTestId("confirm-close"));
    });
    await waitFor(() =>
      expect(f.calls.map((c) => c.path)).toEqual(
        expect.arrayContaining(["/account/close/request", "/account/close/confirm"]),
      ),
    );
    expect(f.calls.find((c) => c.path === "/account/close/confirm")!.body).toEqual({ code: "123456" });
  });

  it("does not close on a malformed code", async () => {
    const f = mockFetch({ "POST /account/close/request": { status: 202, body: {} } });
    await renderApp(<DataScreen />, { fetchImpl: f.impl, identity: true });
    await fireEvent.press(screen.getByTestId("understand-close"));
    await act(async () => {
      await fireEvent.press(screen.getByTestId("request-close"));
    });
    await waitFor(() => screen.getByTestId("close-code"));
    await fireEvent.changeText(screen.getByTestId("close-code"), "12");
    await fireEvent.press(screen.getByTestId("confirm-close"));
    expect(await screen.findByText("Enter the 6-digit code from your email.")).toBeTruthy();
    expect(f.calls.filter((c) => c.path === "/account/close/confirm")).toHaveLength(0);
  });
});

describe("edit profile", () => {
  const known = { profileId: "prof-me", handle: "jane_doe_4821", displayName: "Jane Doe", course: "CS", studyYear: 2 };

  it("loads the current values and saves cleaned-up changes", async () => {
    const f = mockFetch({
      "GET /me/profile": { body: known },
      "PATCH /me/profile": { body: { ...known, displayName: "Janet Mwangi", course: null } },
    });
    await renderApp(<EditProfile />, { fetchImpl: f.impl, identity: true });
    await waitFor(() => expect(screen.getByTestId("edit-name").props.value).toBe("Jane Doe"));

    await fireEvent.changeText(screen.getByTestId("edit-name"), "  Janet    Mwangi ");
    await fireEvent.changeText(screen.getByTestId("edit-course"), "   ");
    await act(async () => {
      await fireEvent.press(screen.getByTestId("save-profile"));
    });

    await waitFor(() => expect(f.calls.find((c) => c.method === "PATCH")).toBeTruthy());
    expect(f.calls.find((c) => c.method === "PATCH")!.body).toEqual({
      displayName: "Janet Mwangi",
      course: null,
      studyYear: 2,
    });
    expect(await screen.findByText("Saved.")).toBeTruthy();
  });

  it("does not save an invalid change", async () => {
    const f = mockFetch({ "GET /me/profile": { body: known } });
    await renderApp(<EditProfile />, { fetchImpl: f.impl, identity: true });
    await waitFor(() => expect(screen.getByTestId("edit-name").props.value).toBe("Jane Doe"));
    await fireEvent.changeText(screen.getByTestId("edit-name"), "   ");
    await fireEvent.press(screen.getByTestId("save-profile"));
    expect(await screen.findByText("Enter your name.")).toBeTruthy();
    expect(f.calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  it("says plainly that email and date of birth are not editable here", async () => {
    await renderApp(<EditProfile />, { fetchImpl: mockFetch({}).impl, identity: true });
    expect(screen.getByText(/cannot be changed here/)).toBeTruthy();
  });
});

describe("report", () => {
  it("needs a reason and tells the reporter they are protected", async () => {
    mockParams = { kind: "post", id: "post-1" };
    const f = mockFetch({});
    await renderApp(<ReportScreen />, { fetchImpl: f.impl, identity: true });
    expect(screen.getByText(/moderators cannot see who sent it/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId("send-report"));
    expect(await screen.findByText("Choose what is wrong.")).toBeTruthy();
    expect(f.calls.filter((c) => c.path === "/reports")).toHaveLength(0);
  });

  it("sends the report and thanks the reporter", async () => {
    mockParams = { kind: "comment", id: "c-1" };
    const f = mockFetch({ "POST /reports": { status: 202, body: { status: "received" } } });
    await renderApp(<ReportScreen />, { fetchImpl: f.impl, identity: true });
    await fireEvent.press(screen.getByRole("checkbox", { name: "Harassment or bullying" }));
    await act(async () => {
      await fireEvent.press(screen.getByTestId("send-report"));
    });
    await waitFor(() => expect(f.calls.find((c) => c.path === "/reports")).toBeTruthy());
    expect(f.calls.find((c) => c.path === "/reports")!.body).toEqual({
      targetKind: "comment",
      targetId: "c-1",
      reason: "harassment",
      detail: null,
    });
    expect(await screen.findByText(/do not tell the person you reported/)).toBeTruthy();
  });
});

describe("feed", () => {
  const page = (items: unknown[], nextCursor: string | null = null) => ({ body: { items, nextCursor } });

  it("lists posts and never shows an anonymous author's real name", async () => {
    const f = mockFetch({
      "GET /me/profiles": { body: MY_PROFILES_NO_ANON },
      "GET /feed": page([
        post({ id: "a", body: "known post" }),
        post({
          id: "b",
          body: "anonymous post",
          author: author({ profileId: "x", kind: "anonymous", handle: "quiet_fox_9", displayName: "Leaked Name" }),
        }),
      ]),
    });
    await renderApp(<FeedScreen />, { fetchImpl: f.impl, identity: true });
    expect(await screen.findByText("known post")).toBeTruthy();
    expect(screen.getByText("anonymous post")).toBeTruthy();
    expect(screen.queryByText("Leaked Name")).toBeNull();
    expect(screen.getByText("@quiet_fox_9")).toBeTruthy();
  });

  it("switches to the following feed", async () => {
    const f = mockFetch({
      "GET /me/profiles": { body: MY_PROFILES_NO_ANON },
      "GET /feed": page([post({ id: "a", body: "campus post" })]),
      "GET /feed/following": page([]),
    });
    await renderApp(<FeedScreen />, { fetchImpl: f.impl, identity: true });
    await screen.findByText("campus post");
    await fireEvent.press(screen.getByRole("button", { name: "Following" }));
    await waitFor(() => expect(f.calls.some((c) => c.path.startsWith("/feed/following"))).toBe(true));
    expect(await screen.findByText(/Follow people to see their posts/)).toBeTruthy();
  });

  it("likes optimistically and puts the count back when the server refuses", async () => {
    const f = mockFetch({
      "GET /me/profiles": { body: MY_PROFILES_NO_ANON },
      "GET /feed": page([post({ id: "a", body: "campus post", reactionCount: 2 })]),
      "PUT /posts/a/reaction": { status: 403, body: { error: "read_only", message: "x" } },
    });
    await renderApp(<FeedScreen />, { fetchImpl: f.impl, identity: true });
    await screen.findByText("campus post");

    await act(async () => {
      await fireEvent.press(screen.getByLabelText("Like, 2 likes"));
    });
    expect(await screen.findByText(/read-only until you re-verify/)).toBeTruthy();
    expect(screen.getByLabelText("Like, 2 likes")).toBeTruthy();
  });

  it("shows a retry when the feed cannot load", async () => {
    const f = mockFetch({
      "GET /me/profiles": { body: MY_PROFILES_NO_ANON },
      "GET /feed": { status: 500, body: { error: "internal_error", message: "boom" } },
    });
    await renderApp(<FeedScreen />, { fetchImpl: f.impl, identity: true });
    expect(await screen.findByText("Could not load posts")).toBeTruthy();
    expect(screen.queryByText("boom")).toBeNull();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
