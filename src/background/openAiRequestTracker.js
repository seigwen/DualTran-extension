"use strict";

const THRESHOLD_OF_PAID_USER = 2;
const REQUEST_WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_TO_KEEP = 110;
const REQUEST_TRIM_THRESHOLD = 200;

function countSuccessfulRequestsInWindow(requestsToOpenAi, timeRangeStartPoint) {
  return requestsToOpenAi.filter((item) => {
    return item.timeStamp > timeRangeStartPoint && item.result === "successful";
  }).length;
}

export function buildOpenAiRequestTrackingUpdate(storage, request) {
  const nextRequestsToOpenAi = Array.isArray(storage?.requestsToOpenAi)
    ? [...storage.requestsToOpenAi]
    : [];

  nextRequestsToOpenAi.push({
    timeStamp: request.timeStamp,
    result: request.result,
  });

  const payload = {};

  if (request.result === "successful" && storage?.openAiUserType !== "paid") {
    const timeRangeStartPoint = request.timeStamp - REQUEST_WINDOW_MS;
    const successfulRequestsCount = countSuccessfulRequestsInWindow(
      nextRequestsToOpenAi,
      timeRangeStartPoint
    );
    if (successfulRequestsCount >= THRESHOLD_OF_PAID_USER) {
      payload.openAiUserType = "paid";
    }
  }

  const previousRequest = nextRequestsToOpenAi[nextRequestsToOpenAi.length - 2];
  if (request.result === "failed" && previousRequest?.result === "successful") {
    const timeRangeStartPoint = previousRequest.timeStamp - REQUEST_WINDOW_MS;
    const successfulRequestsCount = countSuccessfulRequestsInWindow(
      nextRequestsToOpenAi,
      timeRangeStartPoint
    );
    payload.openAiUserType = successfulRequestsCount >= THRESHOLD_OF_PAID_USER ? "paid" : "free";
  }

  payload.requestsToOpenAi =
    nextRequestsToOpenAi.length > REQUEST_TRIM_THRESHOLD
      ? nextRequestsToOpenAi.slice(-MAX_REQUESTS_TO_KEEP)
      : nextRequestsToOpenAi;

  return payload;
}