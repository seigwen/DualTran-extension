/**
 * Public-store-page policy for channels that are still in platform review.
 *
 * A 404 on a channel that has never been published is expected, not a regression.
 * Keep the nightly audit quiet while the platform gate is open; once the channel is
 * marked live, a 404 becomes a hard failure again.
 */
export function publicPagePolicy(channel) {
  const inReview = channel?.status === "in_review";
  return {
    optional: inReview,
    note: inReview
      ? `审核中（${channel.pendingSince || "unknown"} 提交）；上架后改回必检`
      : undefined,
  };
}
