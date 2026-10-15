import { fireEvent, screen } from "@testing-library/react-native";
import { act } from "react";
import { Button } from "@/ui/Button";
import { Notice } from "@/ui/Notice";
import { PostCard, authorTitle } from "@/ui/PostCard";
import { ProfileChip } from "@/ui/ProfileChip";
import { SegmentedControl } from "@/ui/SegmentedControl";
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
    expect(screen.getByText(/@jane_doe_4821/)).toBeTruthy();
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
    expect(screen.getByText(/30 minutes ago/)).toBeTruthy();
  });

  it("marks the viewer's own posts and offers no Report for them", async () => {
    await renderApp(<PostCard post={post()} myProfileIds={["prof-1"]} now={NOW} />);
    expect(screen.getByText("You")).toBeTruthy();
    expect(screen.queryByText("Report")).toBeNull();
  });

  it("keeps Report out of the action row until the person asks for more", async () => {
    const onReport = jest.fn();
    await renderApp(<PostCard post={post()} now={NOW} onReport={onReport} />);
    expect(screen.queryByLabelText("Report this post by Jane Doe")).toBeNull();
    expect(screen.queryByText("Report")).toBeNull();

    const more = screen.getByLabelText("More about this post by Jane Doe");
    expect(more.props.accessibilityState.expanded).toBe(false);
    await fireEvent.press(more);
    expect(screen.getByLabelText("More about this post by Jane Doe").props.accessibilityState.expanded).toBe(true);
    expect(onReport).not.toHaveBeenCalled();
  });

  it("explains what a report does before it is made, then reports once", async () => {
    const onReport = jest.fn();
    await renderApp(<PostCard post={post()} now={NOW} onReport={onReport} />);
    await fireEvent.press(screen.getByLabelText("More about this post by Jane Doe"));

    expect(screen.getByText(/A moderator reviews every report/)).toBeTruthy();
    expect(screen.getByText(/is not told it was\s+you/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Report this post by Jane Doe"));
    expect(onReport).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("Report this post by Jane Doe")).toBeNull();
  });

  it("does not offer Report or More on your own post", async () => {
    await renderApp(
      <PostCard post={post()} now={NOW} myProfileIds={["prof-1"]} onReport={() => {}} />,
    );
    expect(screen.queryByLabelText(/More about this post/)).toBeNull();
  });

  it("shows the like count and says whether you have liked, not by colour alone", async () => {
    await renderApp(<PostCard post={post({ viewerReacted: true, reactionCount: 3 })} now={NOW} />);
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByLabelText("Remove like, 3 likes")).toBeTruthy();
    await renderApp(<PostCard post={post({ viewerReacted: false, reactionCount: 3 })} now={NOW} />);
    expect(screen.getByLabelText("Like, 3 likes")).toBeTruthy();
  });

  it("shows a placeholder with the description, and a retry, when a photo cannot load", async () => {
    const withPhoto = post({
      photos: [{ id: "ph1", url: "/photos/ph1", width: 10, height: 10, altText: "A blue rectangle" }],
    });
    await renderApp(<PostCard post={withPhoto} now={NOW} />);
    await act(async () => {
      fireEvent(screen.getByTestId("post-photos"), "layout", { nativeEvent: { layout: { width: 360, height: 0 } } });
    });
    await act(async () => {
      fireEvent(screen.getByLabelText(/Photo 1 of 1/), "error");
    });
    expect(screen.getByText("This photo could not be loaded")).toBeTruthy();
    expect(screen.getByText("A blue rectangle")).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByLabelText("Try loading photo 1 again"));
    });
    expect(screen.getByLabelText(/Photo 1 of 1: A blue rectangle/)).toBeTruthy();
  });

  it("keeps every action at least 44 points tall", async () => {
    await renderApp(<PostCard post={post()} now={NOW} onOpen={() => {}} onReport={() => {}} />);
    for (const name of [/Like, 2 likes/, /Open comments/, /More about this post/]) {
      const el = screen.getByLabelText(name);
      const flat = Object.assign({}, ...[el.props.style].flat(Infinity).filter(Boolean).map((s: unknown) => (typeof s === "function" ? {} : s)));
      expect(flat.minHeight ?? 0).toBeGreaterThanOrEqual(44);
    }
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
    await act(async () => {
      fireEvent(screen.getByTestId("post-photos"), "layout", { nativeEvent: { layout: { width: 360, height: 0 } } });
    });
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
    await act(async () => {
      fireEvent(screen.getByTestId("post-photos"), "layout", { nativeEvent: { layout: { width: 360, height: 0 } } });
    });
    const img = await screen.findByLabelText(/Photo 1 of 1/);
    expect(img.props.source).toMatchObject({ uri: "https://api.test/photos/ph1" });
  });
});

describe("SegmentedControl", () => {
  const options = [
    { key: "a", label: "Newest" },
    { key: "b", label: "Top this week" },
    { key: "c", label: "Following" },
  ];

  it("exposes tabs with a selected state and a position, in the given order", async () => {
    await renderApp(<SegmentedControl options={options} value="b" onChange={() => {}} label="Show posts" />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(tabs.map((t) => t.props.accessibilityLabel)).toEqual([
      "Newest, 1 of 3",
      "Top this week, 2 of 3",
      "Following, 3 of 3",
    ]);
    expect(tabs.map((t) => t.props.accessibilityState.selected)).toEqual([false, true, false]);
    expect(screen.getByLabelText("Show posts").props.accessibilityRole).toBe("tablist");
  });

  it("changes the selection when a segment is pressed", async () => {
    const onChange = jest.fn();
    await renderApp(<SegmentedControl options={options} value="a" onChange={onChange} label="Show posts" />);
    await fireEvent.press(screen.getByLabelText("Following, 3 of 3"));
    expect(onChange).toHaveBeenCalledWith("c");
  });

  it("shows the visible words unchanged", async () => {
    await renderApp(<SegmentedControl options={options} value="a" onChange={() => {}} label="Show posts" />);
    for (const o of options) expect(screen.getByText(o.label)).toBeTruthy();
  });
});
