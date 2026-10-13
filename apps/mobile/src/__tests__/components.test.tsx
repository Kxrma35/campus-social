import { fireEvent, screen } from "@testing-library/react-native";
import { Button } from "@/ui/Button";
import { Notice } from "@/ui/Notice";
import { PostCard, authorTitle } from "@/ui/PostCard";
import { ProfileChip } from "@/ui/ProfileChip";
import { TextField } from "@/ui/TextField";
import { author, post, renderApp } from "@/testing/helpers";

const NOW = Date.parse("2026-10-12T10:30:00Z");

describe("ProfileChip: colour is never the only signal", () => {
  it("says Anonymous in words", async () => {
    await renderApp(<ProfileChip kind="anonymous" />);
    expect(screen.getByText("Anonymous")).toBeTruthy();
    expect(screen.getByLabelText("anonymous profile")).toBeTruthy();
  });

  it("says You for the viewer's own known profile", async () => {
    await renderApp(<ProfileChip kind="known" self />);
    expect(screen.getByText("You")).toBeTruthy();
  });

  it("reads as a different word in the composer", async () => {
    await renderApp(<ProfileChip kind="anonymous" prefix="Posting as" />);
    expect(screen.getByText("Posting as anonymous")).toBeTruthy();
  });

  it("works in dark mode too", async () => {
    await renderApp(<ProfileChip kind="known" />, { scheme: "dark" });
    expect(screen.getByText("Student")).toBeTruthy();
  });
});

describe("Button", () => {
  it("is announced as a button with its state", async () => {
    const onPress = jest.fn();
    await renderApp(<Button label="Continue" onPress={onPress} />);
    const b = screen.getByRole("button", { name: "Continue" });
    await fireEvent.press(b);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("cannot be pressed while busy or disabled", async () => {
    const onPress = jest.fn();
    await renderApp(
      <>
        <Button label="Busy" onPress={onPress} busy />
        <Button label="Off" onPress={onPress} disabled />
      </>,
    );
    await fireEvent.press(screen.getByRole("button", { name: "Busy" }));
    await fireEvent.press(screen.getByRole("button", { name: "Off" }));
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Busy" }).props.accessibilityState).toMatchObject({
      busy: true,
      disabled: true,
    });
  });

  it("can carry a fuller spoken label than the visible one", async () => {
    await renderApp(<Button label="Report" accessibilityLabel="Report this post by Jane" onPress={() => {}} />);
    expect(screen.getByLabelText("Report this post by Jane")).toBeTruthy();
  });
});

describe("TextField", () => {
  it("has a visible label and exposes it to assistive tech", async () => {
    await renderApp(<TextField label="University email" value="" onChangeText={() => {}} />);
    expect(screen.getByText("University email")).toBeTruthy();
    expect(screen.getByLabelText("University email")).toBeTruthy();
  });

  it("shows an error as text, not just a colour", async () => {
    await renderApp(
      <TextField label="Code" value="" onChangeText={() => {}} error="Enter the 6-digit code." />,
    );
    expect(screen.getByText("Enter the 6-digit code.")).toBeTruthy();
    expect(screen.getByRole("alert")).toBeTruthy();
  });
});

describe("Notice", () => {
  it("announces errors as alerts", async () => {
    await renderApp(<Notice tone="error" title="Could not post">Try again.</Notice>);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("Try again.")).toBeTruthy();
  });
});

describe("PostCard", () => {
  it("shows a known author's name and handle", async () => {
    await renderApp(<PostCard post={post()} now={NOW} />);
    expect(screen.getByText("Jane Doe")).toBeTruthy();
    expect(screen.getByText("@jane_doe_4821")).toBeTruthy();
    expect(screen.getByText("Student")).toBeTruthy();
  });

  it("never shows a real name for an anonymous author, even if one were sent", async () => {
    const leaky = post({
      author: author({ kind: "anonymous", handle: "quiet_fox_4821", displayName: "Jane Doe" }),
    });
    await renderApp(<PostCard post={leaky} now={NOW} />);
    expect(screen.queryByText("Jane Doe")).toBeNull();
    expect(screen.getByText("@quiet_fox_4821")).toBeTruthy();
    expect(screen.getByText("Anonymous")).toBeTruthy();
    expect(authorTitle(leaky.author)).toBe("@quiet_fox_4821");
  });

  it("says 'this hour' rather than a false precise time for anonymous posts", async () => {
    const anon = post({
      author: author({ kind: "anonymous", handle: "quiet_fox_1", displayName: null }),
      createdAt: "2026-10-12T10:00:00.000Z",
    });
    await renderApp(<PostCard post={anon} now={NOW} />);
    expect(screen.getByText("this hour")).toBeTruthy();
    expect(screen.queryByText(/minutes? ago/)).toBeNull();
  });

  it("shows exact relative time for known posts", async () => {
    await renderApp(<PostCard post={post({ createdAt: "2026-10-12T10:00:00.000Z" })} now={NOW} />);
    expect(screen.getByText("30 minutes ago")).toBeTruthy();
  });

  it("marks the viewer's own posts and offers no Report for them", async () => {
    await renderApp(<PostCard post={post()} myProfileIds={["prof-1"]} now={NOW} />);
    expect(screen.getByText("You")).toBeTruthy();
    expect(screen.queryByText("Report")).toBeNull();
  });

  it("offers Report for other people's posts, naming whose post it is", async () => {
    const onReport = jest.fn();
    await renderApp(<PostCard post={post()} now={NOW} onReport={onReport} />);
    await fireEvent.press(screen.getByLabelText("Report this post by Jane Doe"));
    expect(onReport).toHaveBeenCalledTimes(1);
  });

  it("toggles a like and reflects the state in its label", async () => {
    const onToggle = jest.fn();
    await renderApp(
      <PostCard post={post({ viewerReacted: true, reactionCount: 3 })} now={NOW} onToggleReaction={onToggle} />,
    );
    await fireEvent.press(screen.getByLabelText("Remove like, 3 likes"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("summarises the post in one spoken label", async () => {
    await renderApp(<PostCard post={post()} now={NOW} onOpen={() => {}} />);
    expect(
      screen.getByLabelText(/post by Jane Doe, 2 hours ago\. Hello campus/),
    ).toBeTruthy();
  });

  it("announces the author's description of a photo, and says plainly when there is none", async () => {
    const withPhotos = post({
      photos: [
        { id: "ph1", url: "/photos/ph1", width: 10, height: 10, altText: "A red bicycle against a wall" },
        { id: "ph2", url: "/photos/ph2", width: 10, height: 10, altText: null },
      ],
    });
    await renderApp(<PostCard post={withPhotos} now={NOW} />);
    expect(screen.getByLabelText("Photo 1 of 2: A red bicycle against a wall")).toBeTruthy();
    expect(
      screen.getByLabelText("Photo 2 of 2, attached to a post by Jane Doe. No description provided."),
    ).toBeTruthy();
  });

  it("fetches private photos with the session token, not a public link", async () => {
    const withPhoto = post({
      photos: [{ id: "ph1", url: "/photos/ph1", width: 10, height: 10, altText: null }],
    });
    await renderApp(<PostCard post={withPhoto} now={NOW} />);
    const img = await screen.findByLabelText(/Photo 1 of 1/);
    expect(img.props.source).toMatchObject({ uri: "https://api.test/photos/ph1" });
  });
});
