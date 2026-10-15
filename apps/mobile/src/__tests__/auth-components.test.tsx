import { fireEvent, render, screen } from "@testing-library/react-native";
import { useState } from "react";
import { HERO_SLIDES, BETA_QUOTES } from "@/core/heroSlides";
import { HeroPanel } from "@/ui/HeroPanel";
import { IconButton } from "@/ui/IconButton";
import { IdentityBadge } from "@/ui/IdentityBadge";
import { OtpInput } from "@/ui/OtpInput";
import { ThemeProvider } from "@/ui/theme";

const wrap = (ui: React.ReactElement, scheme: "light" | "dark" = "light") =>
  render(<ThemeProvider scheme={scheme}>{ui}</ThemeProvider>);

describe("HeroPanel", () => {
  it("shows real product statements, labelled placeholder art, and never overpromises", async () => {
    await wrap(<HeroPanel slides={HERO_SLIDES} height={300} />);
    expect(screen.getByText("Only verified USIU-Africa students can see what you post.")).toBeTruthy();
    expect(screen.getByLabelText("Placeholder image")).toBeTruthy();
    const all = HERO_SLIDES.map((s) => `${s.text} ${s.support ?? ""}`).join(" ").toLowerCase();
    for (const banned of ["untraceable", "screenshot-proof", "screenshot proof", "100% anonymous", "completely anonymous"]) {
      expect(all).not.toContain(banned);
    }
  });

  it("starts with no invented quotes", () => {
    expect(BETA_QUOTES).toHaveLength(0);
  });

  it("pages with labelled buttons and never advances on its own", async () => {
    jest.useFakeTimers();
    try {
      await wrap(<HeroPanel slides={HERO_SLIDES} height={300} />);
      expect(screen.getByText("1 of 3")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Previous" }).props.accessibilityState.disabled).toBe(true);
      jest.advanceTimersByTime(60_000);
      expect(screen.getByText("1 of 3")).toBeTruthy();
      await fireEvent.press(screen.getByRole("button", { name: "Next" }));
      expect(screen.getByText("2 of 3")).toBeTruthy();
      expect(screen.getByText("Post as yourself, or anonymously.")).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it("shows a labelled back button in the notch only when asked", async () => {
    const back = jest.fn();
    await wrap(<HeroPanel slides={HERO_SLIDES} height={300} onBack={back} />);
    await fireEvent.press(screen.getByRole("button", { name: "Go back" }));
    expect(back).toHaveBeenCalled();
  });
});

describe("OtpInput", () => {
  function Harness() {
    const [v, setV] = useState("");
    return <OtpInput value={v} onChange={setV} testID="otp" />;
  }

  it("keeps digits only and caps at six", async () => {
    await wrap(<Harness />);
    await fireEvent.changeText(screen.getByLabelText("6-digit code"), "12 34-56789");
    expect(screen.getByLabelText("6-digit code").props.value).toBe("123456");
  });

  it("announces itself with a hint and asks the OS for the code", async () => {
    await wrap(<Harness />);
    const input = screen.getByLabelText("6-digit code");
    expect(input.props.accessibilityHint).toMatch(/6 digits/);
    expect(input.props.textContentType).toBe("oneTimeCode");
  });
});

describe("IdentityBadge", () => {
  it("always carries a text label, for both identities", async () => {
    await wrap(
      <>
        <IdentityBadge kind="known" />
        <IdentityBadge kind="anonymous" />
      </>,
    );
    expect(screen.getByText("Your profile")).toBeTruthy();
    expect(screen.getByText("Anonymous profile")).toBeTruthy();
  });
});

describe("IconButton", () => {
  it("is at least 44 points and labelled", async () => {
    const press = jest.fn();
    await wrap(<IconButton icon="plus" label="Add" onPress={press} />);
    const b = screen.getByRole("button", { name: "Add" });
    const style = Array.isArray(b.props.style) ? Object.assign({}, ...b.props.style.flat()) : b.props.style;
    expect(style.width).toBeGreaterThanOrEqual(44);
    expect(style.height).toBeGreaterThanOrEqual(44);
    await fireEvent.press(b);
    expect(press).toHaveBeenCalled();
  });
});
