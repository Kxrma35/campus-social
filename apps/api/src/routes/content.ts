import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { ActorResolver } from "../content/actor.js";
import { MAX_UPLOAD_BYTES } from "../content/photos.js";
import type { ContentService } from "../content/service.js";
import { REPORT_REASONS, type ReportService } from "../moderation/reports.js";
import type { Actor } from "../content/types.js";
import { ApiError } from "../errors.js";

const id = z.string().uuid();
const idParams = z.object({ id });
const page = z.object({
  cursor: z.string().max(300).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
const feedQuery = page.extend({ sort: z.enum(["newest", "top"]).optional() });

const createPost = z.object({
  body: z.string().max(10_000).default(""),
  photoIds: z.array(id).max(10).optional(),
  altTexts: z.record(id, z.string().max(2000)).optional(),
  confirmedAnonymous: z.boolean().optional(),
});
const bodyOnly = z.object({ body: z.string().max(10_000) });
const actingAs = z.enum(["known", "anonymous"]);
const reportBody = z.object({
  targetKind: z.enum(["post", "comment", "profile"]),
  targetId: id,
  reason: z.enum(REPORT_REASONS as unknown as [string, ...string[]]),
  detail: z.string().max(1000).nullish(),
});

function bearer(req: FastifyRequest): string {
  const h = req.headers.authorization;
  const t = h?.startsWith("Bearer ") ? h.slice("Bearer ".length).trim() : "";
  if (!t) throw new ApiError("unauthorized", 401, "Sign in to continue.");
  return t;
}

export function registerContentRoutes(
  app: FastifyInstance,
  content: ContentService,
  actors: ActorResolver,
  reports?: ReportService,
): void {
  async function actor(req: FastifyRequest): Promise<Actor> {
    const raw = req.headers["x-acting-as"];
    const kind = actingAs.parse(typeof raw === "string" ? raw : "known");
    return actors.resolve(bearer(req), kind);
  }

  app.addContentTypeParser(
    ["image/jpeg", "image/png", "image/webp"],
    { parseAs: "buffer", bodyLimit: MAX_UPLOAD_BYTES },
    (_req, body, done) => done(null, body),
  );

  app.post("/photos", async (req, reply) => {
    const a = await actor(req);
    if (!Buffer.isBuffer(req.body)) {
      throw new ApiError("invalid_image", 415, "Send the image as the request body.");
    }
    return reply.code(201).send(await content.uploadPhoto(a, req.body));
  });

  app.patch("/photos/:id", async (req) => {
    const { id: photoId } = idParams.parse(req.params);
    const { altText } = z.object({ altText: z.string().max(2000).nullable() }).parse(req.body);
    return content.setPhotoAltText(await actor(req), photoId, altText);
  });

  app.get("/photos/:id", async (req, reply) => {
    const { id: photoId } = idParams.parse(req.params);
    const bytes = await content.readPhoto(await actor(req), photoId);
    return reply
      .header("content-type", "image/jpeg")
      .header("cache-control", "private, max-age=300")
      .header("x-content-type-options", "nosniff")
      .send(bytes);
  });

  app.put("/me/avatar", async (req) => {
    const { photoId } = z.object({ photoId: id }).strict().parse(req.body);
    return content.setAvatar(await actor(req), photoId);
  });

  app.delete("/me/avatar", async (req) => content.removeAvatar(await actor(req)));

  app.get("/profiles/:id/avatar", async (req, reply) => {
    const { id: profileId } = idParams.parse(req.params);
    const bytes = await content.readAvatar(await actor(req), profileId);
    return reply
      .header("content-type", "image/jpeg")
      // A short private cache so a feed of one person's posts does not refetch the photo each time.
      .header("cache-control", "private, max-age=60")
      .header("x-content-type-options", "nosniff")
      .send(bytes);
  });

  app.post("/posts", async (req, reply) => {
    const body = createPost.parse(req.body);
    const post = await content.createPost(await actor(req), body);
    return reply.code(201).send(post);
  });

  app.get("/posts/:id", async (req) => {
    const { id: postId } = idParams.parse(req.params);
    return content.getPost(await actor(req), postId);
  });

  app.patch("/posts/:id", async (req) => {
    const { id: postId } = idParams.parse(req.params);
    const { body } = bodyOnly.parse(req.body);
    return content.editPost(await actor(req), postId, body);
  });

  app.delete("/posts/:id", async (req, reply) => {
    const { id: postId } = idParams.parse(req.params);
    await content.deletePost(await actor(req), postId);
    return reply.code(204).send();
  });

  app.get("/feed", async (req) => {
    const q = feedQuery.parse(req.query);
    return content.campusFeed(await actor(req), q);
  });

  app.get("/feed/following", async (req) => {
    const q = page.parse(req.query);
    return content.followingFeed(await actor(req), q);
  });

  app.post("/posts/:id/comments", async (req, reply) => {
    const { id: postId } = idParams.parse(req.params);
    const { body } = bodyOnly.parse(req.body);
    return reply.code(201).send(await content.createComment(await actor(req), postId, body));
  });

  app.get("/posts/:id/comments", async (req) => {
    const { id: postId } = idParams.parse(req.params);
    const q = page.parse(req.query);
    return content.listComments(await actor(req), postId, q);
  });

  app.delete("/comments/:id", async (req, reply) => {
    const { id: commentId } = idParams.parse(req.params);
    await content.deleteComment(await actor(req), commentId);
    return reply.code(204).send();
  });

  app.put("/posts/:id/reaction", async (req, reply) => {
    const { id: postId } = idParams.parse(req.params);
    await content.react(await actor(req), { postId });
    return reply.code(204).send();
  });

  app.delete("/posts/:id/reaction", async (req, reply) => {
    const { id: postId } = idParams.parse(req.params);
    await content.unreact(await actor(req), { postId });
    return reply.code(204).send();
  });

  app.put("/comments/:id/reaction", async (req, reply) => {
    const { id: commentId } = idParams.parse(req.params);
    await content.react(await actor(req), { commentId });
    return reply.code(204).send();
  });

  app.delete("/comments/:id/reaction", async (req, reply) => {
    const { id: commentId } = idParams.parse(req.params);
    await content.unreact(await actor(req), { commentId });
    return reply.code(204).send();
  });

  app.get("/profiles/:id", async (req) => {
    const { id: profileId } = idParams.parse(req.params);
    return content.getProfile(await actor(req), profileId);
  });

  app.get("/profiles/:id/posts", async (req) => {
    const { id: profileId } = idParams.parse(req.params);
    const q = page.parse(req.query);
    return content.profilePosts(await actor(req), profileId, q);
  });

  app.put("/profiles/:id/follow", async (req, reply) => {
    const { id: profileId } = idParams.parse(req.params);
    await content.follow(await actor(req), profileId);
    return reply.code(204).send();
  });

  app.delete("/profiles/:id/follow", async (req, reply) => {
    const { id: profileId } = idParams.parse(req.params);
    await content.unfollow(await actor(req), profileId);
    return reply.code(204).send();
  });

  // Lists are only ever shown for the acting profile itself.
  app.get("/me/following", async (req) => {
    return content.myFollowing(await actor(req), page.parse(req.query));
  });

  app.get("/me/followers", async (req) => {
    return content.myFollowers(await actor(req), page.parse(req.query));
  });

  if (reports) {
    app.post("/reports", async (req, reply) => {
      const body = reportBody.parse(req.body);
      const out = await reports.report(await actor(req), {
        targetKind: body.targetKind,
        targetId: body.targetId,
        reason: body.reason as (typeof REPORT_REASONS)[number],
        detail: body.detail ?? null,
      });
      return reply.code(202).send(out);
    });
  }

  app.get("/notifications", async (req) => {
    return content.notifications(await actor(req), page.parse(req.query));
  });

  app.post("/notifications/read", async (req) => {
    return content.markNotificationsRead(await actor(req));
  });
}
