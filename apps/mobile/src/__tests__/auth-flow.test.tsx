import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { mockFetch, renderApp } from "@/testing/helpers";

const mockPush = jest.fn();
const mockDismissAll = jest.fn();
let mockParams: Record<string, string> = {};

jest.mock("expo-router", () => ({
  router: {
    push: (...a: unknown[]) => mockPush(...a),
    dismissAll: () => mockDismissAll(),
    back: jest.fn(),
    replace: jest.fn(),
  },
  useLocalSearchParams: () => mockParams,
  Stack: { Screen: () => null, Protected: ({ children }: { children: unknown }) => children },
}));

import EmailScreen from "@/app/(auth)/email";
import CodeScreen from "@/app/(auth)/code";
import DetailsScreen from "@/app/(auth)/details";

const SESSION = {
  sessionToken: "tok_new",
  expiresAt: "2027-01-01T00:00:00Z",
  account: { id: "a1", status: "active" },
  profile: { id: "p1" },
};

beforeEach(() => {
  mockPush.mockClear();
  mockDismissAll.mockClear();
  mockParams = {};
});

describe("email screen", () => {
  it("does not call the server for an invalid address", async () => {
    mockParams = { mode: "signup" };
    const f = mockFetch({});
    await renderApp(<EmailScreen />, { fetchImpl: f.impl, token: null });

    await fireEvent.changeText(screen.getByTestId("email-input"), "not-an-email");
    await fireEvent.press(screen.getByTestId("send-code"));

    expect(await screen.findByText("Enter a valid email address.")).toBeTruthy();
    expect(f.calls).toHaveLength(0);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("asks for a sign-up code and moves on, using a normalised address", async () => {
    mockParams = { mode: "signup" };
    const f = mockFetch({ "POST /auth/signup/request": { status: 202, body: { status: "code_sent_if_eligible" } } });
    await renderApp(<EmailScreen />, { fetchImpl: f.impl, token: null });

    await fireEvent.changeText(screen.getByTestId("email-input"), "  Jane@USIU.ac.ke ");
    await fireEvent.press(screen.getByTestId("send-code"));

    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    expect(f.calls[0]).toMatchObject({ method: "POST", path: "/auth/signup/request", body: { email: "jane@usiu.ac.ke" } });
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/code",
      params: { mode: "signup", email: "jane@usiu.ac.ke" },
    });
  });

  it("uses the sign-in endpoint in sign-in mode", async () => {
    mockParams = { mode: "login" };
    const f = mockFetch({ "POST /auth/login/request": { status: 202, body: { status: "code_sent_if_eligible" } } });
    await renderApp(<EmailScreen />, { fetchImpl: f.impl, token: null });
    await fireEvent.changeText(screen.getByTestId("email-input"), "jane@usiu.ac.ke");
    await fireEvent.press(screen.getByTestId("send-code"));
    await waitFor(() => expect(f.calls).toHaveLength(1));
    expect(f.calls[0]!.path).toBe("/auth/login/request");
  });

  it("explains a domain that is not supported", async () => {
    mockParams = { mode: "signup" };
    const f = mockFetch({
      "POST /auth/signup/request": {
        status: 422,
        body: { error: "university_not_supported", message: "x" },
      },
    });
    await renderApp(<EmailScreen />, { fetchImpl: f.impl, token: null });
    await fireEvent.changeText(screen.getByTestId("email-input"), "jane@gmail.com");
    await fireEvent.press(screen.getByTestId("send-code"));
    expect(await screen.findByText(/not from a university that can use Campus Social/)).toBeTruthy();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("shows a friendly message when the server cannot be reached", async () => {
    mockParams = { mode: "signup" };
    const impl = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    await renderApp(<EmailScreen />, { fetchImpl: impl, token: null });
    await fireEvent.changeText(screen.getByTestId("email-input"), "jane@usiu.ac.ke");
    await fireEvent.press(screen.getByTestId("send-code"));
    expect(await screen.findByText(/Can't reach the server/)).toBeTruthy();
  });
});

describe("code screen", () => {
  it("signs in with a login code", async () => {
    mockParams = { mode: "login", email: "jane@usiu.ac.ke" };
    const f = mockFetch({ "POST /auth/login/verify": { status: 200, body: SESSION } });
    await renderApp(<CodeScreen />, { fetchImpl: f.impl, token: null });

    await fireEvent.changeText(screen.getByTestId("code-input"), "123 456");
    await act(async () => {
      await fireEvent.press(screen.getByTestId("submit-code"));
    });

    await waitFor(() => expect(f.calls).toHaveLength(1));
    expect(f.calls[0]).toMatchObject({
      path: "/auth/login/verify",
      body: { email: "jane@usiu.ac.ke", code: "123456" },
    });
  });

  it("does not spend a sign-up code until the details are in", async () => {
    mockParams = { mode: "signup", email: "jane@usiu.ac.ke" };
    const f = mockFetch({});
    await renderApp(<CodeScreen />, { fetchImpl: f.impl, token: null });

    await fireEvent.changeText(screen.getByTestId("code-input"), "123456");
    await fireEvent.press(screen.getByTestId("submit-code"));

    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    expect(f.calls).toHaveLength(0);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/details",
      params: { email: "jane@usiu.ac.ke", code: "123456" },
    });
  });

  it("rejects a malformed code without calling the server", async () => {
    mockParams = { mode: "login", email: "jane@usiu.ac.ke" };
    const f = mockFetch({});
    await renderApp(<CodeScreen />, { fetchImpl: f.impl, token: null });
    await fireEvent.changeText(screen.getByTestId("code-input"), "12ab");
    await fireEvent.press(screen.getByTestId("submit-code"));
    expect(await screen.findByText("Enter the 6-digit code from your email.")).toBeTruthy();
    expect(f.calls).toHaveLength(0);
  });

  it("explains a wrong code", async () => {
    mockParams = { mode: "login", email: "jane@usiu.ac.ke" };
    const f = mockFetch({
      "POST /auth/login/verify": { status: 400, body: { error: "invalid_code", message: "x" } },
    });
    await renderApp(<CodeScreen />, { fetchImpl: f.impl, token: null });
    await fireEvent.changeText(screen.getByTestId("code-input"), "000000");
    await fireEvent.press(screen.getByTestId("submit-code"));
    expect(await screen.findByText(/That code is not right/)).toBeTruthy();
  });
});

describe("sign-up details screen (consent)", () => {
  const fill = async () => {
    await fireEvent.changeText(screen.getByTestId("name-input"), "  Jane   Doe ");
    await fireEvent.changeText(screen.getByTestId("course-input"), "Computer Science");
    await fireEvent.changeText(screen.getByTestId("year-input"), "2");
    await fireEvent.changeText(screen.getByTestId("dob-day"), "1");
    await fireEvent.changeText(screen.getByTestId("dob-month"), "5");
    await fireEvent.changeText(screen.getByTestId("dob-year"), "2004");
  };

  beforeEach(() => {
    mockParams = { email: "jane@usiu.ac.ke", code: "123456" };
  });

  it("starts with both consent boxes unticked", async () => {
    await renderApp(<DetailsScreen />, { fetchImpl: mockFetch({}).impl, token: null });
    expect(screen.getByTestId("over18").props.accessibilityState.checked).toBe(false);
    expect(screen.getByTestId("accept-terms").props.accessibilityState.checked).toBe(false);
  });

  it("sends nothing and names what is missing when consent has not been given", async () => {
    const f = mockFetch({});
    await renderApp(<DetailsScreen />, { fetchImpl: f.impl, token: null });
    await fill();
    await fireEvent.press(screen.getByTestId("create-account"));

    expect(await screen.findByText("Confirm that you are 18 or older.")).toBeTruthy();
    expect(screen.getByText("Agree to the terms to continue.")).toBeTruthy();
    expect(f.calls).toHaveLength(0);
  });

  it("does not accept the terms by ticking only the age box", async () => {
    const f = mockFetch({});
    await renderApp(<DetailsScreen />, { fetchImpl: f.impl, token: null });
    await fill();
    await fireEvent.press(screen.getByTestId("over18"));
    await fireEvent.press(screen.getByTestId("create-account"));
    expect(await screen.findByText("Agree to the terms to continue.")).toBeTruthy();
    expect(f.calls).toHaveLength(0);
  });

  it("blocks someone whose date of birth makes them under 18, before any request", async () => {
    const f = mockFetch({});
    await renderApp(<DetailsScreen />, { fetchImpl: f.impl, token: null });
    await fill();
    await fireEvent.changeText(screen.getByTestId("dob-year"), "2012");
    await fireEvent.press(screen.getByTestId("over18"));
    await fireEvent.press(screen.getByTestId("accept-terms"));
    await fireEvent.press(screen.getByTestId("create-account"));

    expect(await screen.findByText("You must be 18 or older to use Campus Social.")).toBeTruthy();
    expect(f.calls).toHaveLength(0);
  });

  it("rejects an impossible date", async () => {
    const f = mockFetch({});
    await renderApp(<DetailsScreen />, { fetchImpl: f.impl, token: null });
    await fill();
    await fireEvent.changeText(screen.getByTestId("dob-day"), "31");
    await fireEvent.changeText(screen.getByTestId("dob-month"), "2");
    await fireEvent.press(screen.getByTestId("over18"));
    await fireEvent.press(screen.getByTestId("accept-terms"));
    await fireEvent.press(screen.getByTestId("create-account"));
    expect(await screen.findByText("That date does not exist.")).toBeTruthy();
    expect(f.calls).toHaveLength(0);
  });

  it("creates the account with explicit consent and a cleaned-up profile", async () => {
    const f = mockFetch({ "POST /auth/signup/verify": { status: 201, body: SESSION } });
    await renderApp(<DetailsScreen />, { fetchImpl: f.impl, token: null });
    await fill();
    await fireEvent.press(screen.getByTestId("over18"));
    await fireEvent.press(screen.getByTestId("accept-terms"));
    await act(async () => {
      await fireEvent.press(screen.getByTestId("create-account"));
    });

    await waitFor(() => expect(f.calls).toHaveLength(1));
    expect(f.calls[0]!.path).toBe("/auth/signup/verify");
    expect(f.calls[0]!.body).toEqual({
      email: "jane@usiu.ac.ke",
      code: "123456",
      dateOfBirth: "2004-05-01",
      displayName: "Jane Doe",
      course: "Computer Science",
      studyYear: 2,
      confirmAge18: true,
      acceptTerms: true,
    });
  });

  it("offers a new code when the code turned out to be wrong or expired", async () => {
    const f = mockFetch({
      "POST /auth/signup/verify": { status: 400, body: { error: "code_expired", message: "x" } },
    });
    await renderApp(<DetailsScreen />, { fetchImpl: f.impl, token: null });
    await fill();
    await fireEvent.press(screen.getByTestId("over18"));
    await fireEvent.press(screen.getByTestId("accept-terms"));
    await act(async () => {
      await fireEvent.press(screen.getByTestId("create-account"));
    });

    expect(await screen.findByText(/That code has expired/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Request a new code" }));
    expect(mockDismissAll).toHaveBeenCalled();
  });
});
