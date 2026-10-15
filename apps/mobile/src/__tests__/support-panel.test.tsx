import { fireEvent, screen } from "@testing-library/react-native";
import { Linking } from "react-native";
import { renderApp } from "@/testing/helpers";
import { SupportPanel } from "@/ui/SupportPanel";

const SUPPORT = {
  message: "You do not have to face this alone.",
  resources: [
    { name: "Befrienders Kenya: every day 9:00 to 17:00", contact: "+254 722 178 177" },
    { name: "NACADA: 24 hours", contact: "1192" },
    { name: "Counseling Center", contact: "visit the Freida Brown Student Centre" },
  ],
};

describe("support panel", () => {
  it("offers a call button for a full number and for a short code", async () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    await renderApp(<SupportPanel support={SUPPORT} onDone={() => undefined} />);

    await fireEvent.press(screen.getByRole("button", { name: /Call NACADA/ }));
    expect(open).toHaveBeenCalledWith("tel:1192");

    await fireEvent.press(screen.getByRole("button", { name: /Call Befrienders Kenya/ }));
    expect(open).toHaveBeenCalledWith("tel:+254722178177");
    open.mockRestore();
  });

  it("shows text-only contacts without a call button", async () => {
    await renderApp(<SupportPanel support={SUPPORT} onDone={() => undefined} />);
    expect(screen.getByText("visit the Freida Brown Student Centre")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Call Counseling Center/ })).toBeNull();
  });

  it("falls back to emergency services wording when there are no resources, and invents no number", async () => {
    await renderApp(
      <SupportPanel support={{ message: "m", resources: [] }} onDone={() => undefined} />,
    );
    expect(screen.getByText(/local emergency services/)).toBeTruthy();
    expect(screen.queryByText(/\d{4,}/)).toBeNull();
  });
});
