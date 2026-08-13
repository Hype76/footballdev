export function orderParentPortalChatMessagesNewestFirst(messages = []) {
  return messages
    .map((message, index) => ({ index, message, time: Date.parse(message?.createdAt || '') }))
    .sort((left, right) => {
      const leftTime = Number.isFinite(left.time) ? left.time : 0
      const rightTime = Number.isFinite(right.time) ? right.time : 0
      return rightTime - leftTime || left.index - right.index
    })
    .map((entry) => entry.message)
}
