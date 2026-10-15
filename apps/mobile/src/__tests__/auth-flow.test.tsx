import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { mockFetch, renderApp } from "@/testing/helpers";

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockDismissTo = jest.fn();
let mockParams: Record<string, string> = {};

jest.mock("expo-router", () => ({
  router: {
    push: (...a: unknown[]) => mockPush(...a),
    replace: (...a: unknown[]) => mockReplace(...a),
    dismissTo: (...a: unknown[]) => mockDismissTo(...a),
    back: jest.fn(),
    canGoBack: () => true,
  },
  useLocalSearchParams: () => mockParams,
  Stack: { Screen: () => null, Protected: ({ children }: { children: unknown }) => children },
}));

import EmailScreen from "@/app/(auth)/email";
import CodeScreen from "@/app/(auth)/code";
import BirthDate from "@/app/(auth)/birthdate";
import Agreements from "@/app/(auth)/agreements";
import ProfileSetup from "@/app/(auth)/profile";
import Underage from "@/app/(auth)/underage";
import PendingApproval from "@/app/(auth)/pending";
import DraftDocument from "@/app/(auth)/draft/[slug]";
import Done from "@/app/(auth)/done";

const FLOW = { email: "jane@usiu.ac.ke", code: "123456", dateOfBirth: "2004-05-01" };

const SESSION = {
  sessionToken: "tok_new",
  expiresAt: "2027-01-01T00:00:00Z",
  account: { id: "a1", status: "active" },
  profile: { id: "p1" },
};

beforeEach(() => {
  mockPush.mockClear();
  mockReplace.mockClear();
  mockDismissTo.mockClear();
  mockParams = {};
});

describe("email screen", () => {
  it("does not call the server for an invalid address", async () => {
    mockParams = { mode: "signup" };
    const f = mockFetch({});
    await renderApp(<EmailScreen />, { fetchImpl: f.impl, token: null });

    await fireEvent.changeText(screen.getByLabelText("University email"), "not-an-email");
    await fireEvent.press(screen.getByRole("button", { name: "Send code" }));

    expect(await screen.findByText("Enter a valid email address.")).toBeTruthy();
    expect(f.calls).toHaveLength(0);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("shows an inline error for a non-USIU address before any request", async () => {
    mockParams = { mode: "signup" };
    const f = mockFetch({});
    await renderApp(<EmailScreen />, { fetchImpl: f.impl, token: null });

    await fireEvent.changeText(screen.getByLabelText("University email"), "jane@gmail.com");
    await fireEvent.press(screen.getByRole("button", { name: "Send code" }));

    expect(await screen.findByText(/Use your university email ending in @usiu.ac.ke/)).toBeTruthy();
    expect(f.calls).toHaveLength(0);
  });

  it("asks for a sign-up code and moves on, using a normalised address", async () => {
    mockParams = { mode: "signup" };
    const f = mockFetch({ "POST /auth/signup/request": { status: 202, body: { status: "code_sent_if_eligible" } } });
    await renderApp(<EmailScreen />, { fetchImpl: f.impl, token: null });

    await fireEvent.changeText(screen.getByLabelText("University email"), "  Jane@USIU.ac.ke ");
    await fireEvent.press(screen.getByRole("button", { name: "Send code" }));

    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    expect(f.calls[0]).toMatchObject({ method: "POST", path: "/auth/signup/request", body: { email: "jane@usiu.ac.ke" } });
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/code", params: { mode: "signup" } });
    expect(JSON.stringify(mockPush.mock.calls)).not.toContain("jane");
  });

  it("uses the sign-in endpoint in sign-in mode", async () => {
    mockParams = { mode: "login" };
    const f = mockFetch({ "POST /auth/login/request": { status: 202, body: { status: "code_sent_if_eligible" } } });
    await renderApp(<EmailScreen />, { fetchImpl: f.impl, token: null });
    await fireEvent.changeText(screen.getByLabelText("University email"), "jane@usiu.ac.ke");
    await fireEvent.press(screen.getByRole("button", { name: "Send code" }));
    await waitFor(() => expect(f.calls).toHaveLength(1));
    expect(f.calls[0]!.path).toBe("/auth/login/request");
  });

  it("switches between sign in and sign up from the bottom link", async () => {
    mockParams = { mode: "login" };
    await renderApp(<EmailScreen />, { fetchImpl: mockFetch({}).impl, token: null });
    await fireEvent.press(screen.getByRole("button", { name: "Sign up" }));
    expect(mockReplace).toHaveBeenCalledWith({ pathname: "/email", params: { mode: "signup" } });
  });

  it("explains a domain the server does not support", async () => {
    mockParams = { mode: "signup" };
    const f = mockFetch({
      "POST /auth/signup/request": { status: 422, body: { error: "university_not_supported", message: "x" } },
    });
    await renderApp(<EmailScreen />, { fetchImpl: f.impl, token: null });
    await fireEvent.changeText(screen.getByLabelText("University email"), "jane@usiu.ac.ke");
    await fireEvent.press(screen.getByRole("button", { name: "Send code" }));
    expect(await screen.findByText(/not from a university that can use Moku/)).toBeTruthy();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("shows a friendly message when the server cannot be reached", async () => {
    mockParams = { mode: "signup" };
    const impl = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    await renderApp(<EmailScreen />, { fetchImpl: impl, token: null });
    await fireEvent.changeText(screen.getByLabelText("University email"), "jane@usiu.ac.ke");
    await fireEvent.press(screen.getByRole("button", { name: "Send code" }));
    expect(await screen.findByText(/Can't reach the server/)).toBeTruthy();
  });

  it("shows a rate limit message", async () => {
    mockParams = { mode: "signup" };
    const f = mockFetch({
      "POST /auth/signup/request": { status: 429, body: { error: "too_many_requests", message: "x" } },
    });
    await renderApp(<EmailScreen />, { fetchImpl: f.impl, token: null });
    await fireEvent.changeText(screen.getByLabelText("University email"), "jane@usiu.ac.ke");
    await fireEvent.press(screen.getByRole("button", { name: "Send code" }));
    expect(await screen.findByText(/Too many codes requested/)).toBeTruthy();
  });

  it("shows a server error message", async () => {
    mockParams = { mode: "signup" };
    const f = mockFetch({
      "POST /auth/signup/request": { status: 500, body: { error: "internal", message: "x" } },
    });
    await renderApp(<EmailScreen />, { fetchImpl: f.impl, token: null });
    await fireEvent.changeText(screen.getByLabelText("University email"), "jane@usiu.ac.ke");
    await fireEvent.press(screen.getByRole("button", { name: "Send code" }));
    expect(await screen.findByText(/went wrong on our side/)).toBeTruthy();
  });
});

describe("code screen", () => {
  it("signs in with a login code", async () => {
    mockParams = { mode: "login" };
    const f = mockFetch({ "POST /auth/login/verify": { status: 200, body: SESSION } });
    await renderApp(<CodeScreen />, { fetchImpl: f.impl, token: null, authFlow: { email: "jane@usiu.ac.ke" } });

    await fireEvent.changeText(screen.getByLabelText("6-digit code"), "123 456");
    await act(async () => {
      await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
    });

    await waitFor(() => expect(f.calls).toHaveLength(1));
    expect(f.calls[0]).toMatchObject({
      path: "/auth/login/verify",
      body: { email: "jane@usiu.ac.ke", code: "123456" },
    });
  });

  it("asks the system for the one-time code", async () => {
    mockParams = { mode: "login" };
    await renderApp(<CodeScreen />, { fetchImpl: mockFetch({}).impl, token: null, authFlow: { email: "jane@usiu.ac.ke" } });
    const input = screen.getByLabelText("6-digit code");
    expect(input.props.textContentType).toBe("oneTimeCode");
    expect(input.props.autoComplete).toBe("one-time-code");
  });

  it("does not spend a sign-up code until the profile is in, and moves to the birth date", async () => {
    mockParams = { mode: "signup" };
    const f = mockFetch({});
    await renderApp(<CodeScreen />, { fetchImpl: f.impl, token: null, authFlow: { email: "jane@usiu.ac.ke" } });

    await fireEvent.changeText(screen.getByLabelText("6-digit code"), "123456");
    await fireEvent.press(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    expect(f.calls).toHaveLength(0);
    expect(mockPush).toHaveBeenCalledWith("/birthdate");
    const pushed = JSON.stringify(mockPush.mock.calls);
    expect(pushed).not.toContain("jane");
    expect(pushed).not.toContain("123456");
  });

  it("offers a fresh start when the page was reloaded and the email is gone", async () => {
    mockParams = { mode: "login" };
    await renderApp(<CodeScreen />, { fetchImpl: mockFetch({}).impl, token: null });
    expect(screen.getByText("Let's start again")).toBeTruthy();
    expect(screen.queryByLabelText("6-digit code")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Start again" }));
    expect(mockReplace).toHaveBeenCalledWith("/welcome");
  });

  it("rejects a malformed code without calling the server", async () => {
    mockParams = { mode: "login" };
    const f = mockFetch({});
    await renderApp(<CodeScreen />, { fetchImpl: f.impl, token: null, authFlow: { email: "jane@usiu.ac.ke" } });
    await fireEvent.changeText(screen.getByLabelText("6-digit code"), "12ab");
    await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Enter the 6-digit code from your email.")).toBeTruthy();
    expect(f.calls).toHaveLength(0);
  });

  it("explains a wrong code", async () => {
    mockParams = { mode: "login" };
    const f = mockFetch({
      "POST /auth/login/verify": { status: 400, body: { error: "invalid_code", message: "x" } },
    });
    await renderApp(<CodeScreen />, { fetchImpl: f.impl, token: null, authFlow: { email: "jane@usiu.ac.ke" } });
    await fireEvent.changeText(screen.getByLabelText("6-digit code"), "000000");
    await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText(/That code is not right/)).toBeTruthy();
  });

  it("explains too many attempts", async () => {
    mockParams = { mode: "login" };
    const f = mockFetch({
      "POST /auth/login/verify": { status: 429, body: { error: "too_many_attempts", message: "x" } },
    });
    await renderApp(<CodeScreen />, { fetchImpl: f.impl, token: null, authFlow: { email: "jane@usiu.ac.ke" } });
    await fireEvent.changeText(screen.getByLabelText("6-digit code"), "000000");
    await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText(/Too many wrong codes/)).toBeTruthy();
  });

  it("shows the expiry, blocks resend during the cooldown, and returns to change email", async () => {
    mockParams = { mode: "login" };
    await renderApp(<CodeScreen />, { fetchImpl: mockFetch({}).impl, token: null, authFlow: { email: "jane@usiu.ac.ke" } });
    expect(screen.getByText(/Code expires in/)).toBeTruthy();
    const resend = screen.getByRole("button", { name: /Send a new code in/ });
    expect(resend.props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByRole("button", { name: "Change email" }));
    expect(mockReplace).toHaveBeenCalledWith({ pathname: "/email", params: { mode: "login" } });
  });

  it("marks the code expired after ten minutes and disables sign in", async () => {
    jest.useFakeTimers();
    try {
      mockParams = { mode: "login" };
      await renderApp(<CodeScreen />, { fetchImpl: mockFetch({}).impl, token: null, authFlow: { email: "jane@usiu.ac.ke" } });
      await act(async () => {
        jest.advanceTimersByTime(10 * 60_000 + 1500);
      });
      expect(screen.getByText("This code has expired. Send a new one.")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Sign in" }).props.accessibilityState.disabled).toBe(true);
      expect(screen.getByRole("button", { name: "Send a new code" }).props.accessibilityState.disabled).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("birth date screen", () => {
  const fill = async (d = "1", m = "5", y = "2004") => {
    await fireEvent.changeText(screen.getByLabelText("Day"), d);
    await fireEvent.changeText(screen.getByLabelText("Month"), m);
    await fireEvent.changeText(screen.getByLabelText("Year"), y);
  };

  it("offers a fresh start when the email or code is gone", async () => {
    await renderApp(<BirthDate />, { fetchImpl: mockFetch({}).impl, token: null });
    expect(screen.getByText("Let's start again")).toBeTruthy();
  });

  it("starts with the age box unticked and asks for it", async () => {
    await renderApp(<BirthDate />, { fetchImpl: mockFetch({}).impl, token: null, authFlow: FLOW });
    const box = screen.getByRole("checkbox", { name: /18 years old or older/ });
    expect(box.props.accessibilityState.checked).toBe(false);
    await fill();
    await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Confirm that you are 18 or older.")).toBeTruthy();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("rejects an impossible date", async () => {
    await renderApp(<BirthDate />, { fetchImpl: mockFetch({}).impl, token: null, authFlow: FLOW });
    await fill("31", "2", "2004");
    await fireEvent.press(screen.getByRole("checkbox", { name: /18 years old or older/ }));
    await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("That date does not exist.")).toBeTruthy();
  });

  it("stops someone under 18 without any request and drops what was entered", async () => {
    const f = mockFetch({});
    await renderApp(<BirthDate />, { fetchImpl: f.impl, token: null, authFlow: FLOW });
    await fill("1", "5", "2012");
    await fireEvent.press(screen.getByRole("checkbox", { name: /18 years old or older/ }));
    await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
    expect(mockReplace).toHaveBeenCalledWith("/underage");
    expect(f.calls).toHaveLength(0);
  });

  it("moves on with a valid adult date", async () => {
    await renderApp(<BirthDate />, { fetchImpl: mockFetch({}).impl, token: null, authFlow: FLOW });
    await fill();
    await fireEvent.press(screen.getByRole("checkbox", { name: /18 years old or older/ }));
    await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
    expect(mockPush).toHaveBeenCalledWith("/agreements");
  });
});

describe("under 18 stop screen", () => {
  it("is respectful, creates nothing and offers a way out", async () => {
    const f = mockFetch({});
    await renderApp(<Underage />, { fetchImpl: f.impl, token: null });
    expect(screen.getByText(/only for students aged 18 and over/)).toBeTruthy();
    expect(screen.getByText(/not kept anything you entered/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Close" }));
    expect(mockReplace).toHaveBeenCalledWith("/welcome");
    expect(f.calls).toHaveLength(0);
  });
});

describe("agreements screen", () => {
  it("shows three separate unticked boxes", async () => {
    await renderApp(<Agreements />, { fetchImpl: mockFetch({}).impl, token: null, authFlow: FLOW });
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(3);
    for (const b of boxes) expect(b.props.accessibilityState.checked).toBe(false);
  });

  it("ticks each box on its own", async () => {
    await renderApp(<Agreements />, { fetchImpl: mockFetch({}).impl, token: null, authFlow: FLOW });
    await fireEvent.press(screen.getByRole("checkbox", { name: /Terms of service/ }));
    expect(screen.getByRole("checkbox", { name: /Terms of service/ }).props.accessibilityState.checked).toBe(true);
    expect(screen.getByRole("checkbox", { name: /Privacy policy/ }).props.accessibilityState.checked).toBe(false);
    expect(screen.getByRole("checkbox", { name: /Community rules/ }).props.accessibilityState.checked).toBe(false);
  });

  it("will not continue until every box is ticked", async () => {
    await renderApp(<Agreements />, { fetchImpl: mockFetch({}).impl, token: null, authFlow: FLOW });
    await fireEvent.press(screen.getByRole("checkbox", { name: /Terms of service/ }));
    await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText(/Tick each box to continue/)).toBeTruthy();
    expect(mockPush).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole("checkbox", { name: /Privacy policy/ }));
    await fireEvent.press(screen.getByRole("checkbox", { name: /Community rules/ }));
    await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
    expect(mockPush).toHaveBeenCalledWith("/profile");
  });

  it("links each document to a draft screen", async () => {
    await renderApp(<Agreements />, { fetchImpl: mockFetch({}).impl, token: null, authFlow: FLOW });
    await fireEvent.press(screen.getByRole("button", { name: /Read the Privacy policy/ }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/draft/[slug]", params: { slug: "privacy" } });
  });
});

describe("draft document screen", () => {
  it("is marked DRAFT and carries no legal text", async () => {
    mockParams = { slug: "terms" };
    await renderApp(<DraftDocument />, { fetchImpl: mockFetch({}).impl, token: null });
    expect(screen.getByText("DRAFT")).toBeTruthy();
    expect(screen.getByText("Terms of service")).toBeTruthy();
    expect(screen.getByText(/has not been written or reviewed by a lawyer/)).toBeTruthy();
  });
});

describe("profile setup screen", () => {
  const fillName = async () => {
    await fireEvent.changeText(screen.getByLabelText("Your name"), "  Jane   Doe ");
  };

  it("offers a fresh start when earlier steps are missing", async () => {
    await renderApp(<ProfileSetup />, { fetchImpl: mockFetch({}).impl, token: null, authFlow: { email: "jane@usiu.ac.ke" } });
    expect(screen.getByText("Let's start again")).toBeTruthy();
  });

  it("creates the account with a cleaned-up profile and the chosen handle", async () => {
    const f = mockFetch({ "POST /auth/signup/verify": { status: 201, body: SESSION } });
    await renderApp(<ProfileSetup />, { fetchImpl: f.impl, token: null, authFlow: FLOW });
    await fillName();
    await fireEvent.changeText(screen.getByLabelText("Handle (optional)"), "@Jane_D");
    await fireEvent.changeText(screen.getByLabelText("Course (optional)"), "Computer Science");
    await fireEvent.changeText(screen.getByLabelText("Year of study (optional)"), "2");
    await act(async () => {
      await fireEvent.press(screen.getByRole("button", { name: "Create my account" }));
    });

    await waitFor(() => expect(f.calls).toHaveLength(1));
    expect(f.calls[0]!.body).toEqual({
      email: "jane@usiu.ac.ke",
      code: "123456",
      dateOfBirth: "2004-05-01",
      displayName: "Jane Doe",
      handle: "jane_d",
      course: "Computer Science",
      studyYear: 2,
      confirmAge18: true,
      acceptTerms: true,
    });
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/done"));
  });

  it("sends no handle when left blank", async () => {
    const f = mockFetch({ "POST /auth/signup/verify": { status: 201, body: SESSION } });
    await renderApp(<ProfileSetup />, { fetchImpl: f.impl, token: null, authFlow: FLOW });
    await fillName();
    await act(async () => {
      await fireEvent.press(screen.getByRole("button", { name: "Create my account" }));
    });
    await waitFor(() => expect(f.calls).toHaveLength(1));
    expect((f.calls[0]!.body as { handle: unknown }).handle).toBeNull();
  });

  it("rejects a reserved handle before any request", async () => {
    const f = mockFetch({});
    await renderApp(<ProfileSetup />, { fetchImpl: f.impl, token: null, authFlow: FLOW });
    await fillName();
    await fireEvent.changeText(screen.getByLabelText("Handle (optional)"), "moderator");
    await fireEvent.press(screen.getByRole("button", { name: "Create my account" }));
    expect(await screen.findByText(/reserved/)).toBeTruthy();
    expect(f.calls).toHaveLength(0);
  });

  it("shows a taken handle on the handle field", async () => {
    const f = mockFetch({
      "POST /auth/signup/verify": { status: 409, body: { error: "handle_taken", message: "x" } },
    });
    await renderApp(<ProfileSetup />, { fetchImpl: f.impl, token: null, authFlow: FLOW });
    await fillName();
    await fireEvent.changeText(screen.getByLabelText("Handle (optional)"), "jane_d");
    await act(async () => {
      await fireEvent.press(screen.getByRole("button", { name: "Create my account" }));
    });
    expect(await screen.findByText(/already taken/)).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("goes back to the code screen when the code turned out to be expired", async () => {
    const f = mockFetch({
      "POST /auth/signup/verify": { status: 400, body: { error: "code_expired", message: "x" } },
    });
    await renderApp(<ProfileSetup />, { fetchImpl: f.impl, token: null, authFlow: FLOW });
    await fillName();
    await act(async () => {
      await fireEvent.press(screen.getByRole("button", { name: "Create my account" }));
    });
    await waitFor(() => expect(mockDismissTo).toHaveBeenCalledWith({ pathname: "/code", params: { mode: "signup" } }));
  });

  it("shows an offline message and stays put", async () => {
    const impl = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    await renderApp(<ProfileSetup />, { fetchImpl: impl, token: null, authFlow: FLOW });
    await fillName();
    await act(async () => {
      await fireEvent.press(screen.getByRole("button", { name: "Create my account" }));
    });
    expect(await screen.findByText(/Can't reach the server/)).toBeTruthy();
  });
});

describe("done and pending screens", () => {
  it("done offers a way back when there is no session to open", async () => {
    await renderApp(<Done />, { fetchImpl: mockFetch({}).impl, token: null });
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  });

  it("pending approval promises nothing it cannot do", async () => {
    const f = mockFetch({});
    await renderApp(<PendingApproval />, { fetchImpl: f.impl, token: null });
    expect(screen.getByText(/Nothing has been sent from this screen/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Back" }));
    expect(mockReplace).toHaveBeenCalledWith("/welcome");
    expect(f.calls).toHaveLength(0);
  });
});
