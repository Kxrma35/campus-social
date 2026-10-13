import { randomInt } from "node:crypto";

const ADJECTIVES = [
  "quiet", "bright", "calm", "swift", "gentle", "bold", "curious", "mellow", "sunny", "clever",
  "brave", "witty", "humble", "lively", "steady", "cosmic", "dusty", "golden", "silver", "misty",
  "amber", "coral", "velvet", "wandering", "midnight", "morning", "rapid", "patient", "lucky", "wild",
];

const NOUNS = [
  "fox", "heron", "otter", "falcon", "lynx", "ibis", "gecko", "panda", "sparrow", "badger",
  "kestrel", "lemur", "pangolin", "gazelle", "weaver", "cheetah", "mongoose", "starling", "hornbill", "oryx",
  "dikdik", "serval", "plover", "bushbaby", "genet", "eland", "kingfisher", "zebra", "warthog", "sunbird",
];

const AVATAR_COLOURS = 12;
const AVATAR_SHAPES = 8;

export function generateAnonymousIdentity(): { handle: string; avatarKey: string } {
  const adjective = ADJECTIVES[randomInt(ADJECTIVES.length)]!;
  const noun = NOUNS[randomInt(NOUNS.length)]!;
  const number = randomInt(1000, 10_000);
  return {
    handle: `${adjective}_${noun}_${number}`,
    avatarKey: `gen:${randomInt(AVATAR_COLOURS)}:${randomInt(AVATAR_SHAPES)}`,
  };
}
