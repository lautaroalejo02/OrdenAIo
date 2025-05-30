import prisma from '../utils/database.js';

/**
 * Get or create an order draft for a conversation.
 * @param {string} conversationId
 * @returns {Promise<Object>} The order draft
 */
export async function getOrCreateDraft(conversationId) {
  let draft = await prisma.orderDraft.findFirst({
    where: { conversationId, status: 'IN_PROGRESS' },
  });
  if (!draft) {
    draft = await prisma.orderDraft.create({
      data: { conversationId },
    });
  }
  return draft;
}

/**
 * Update an order draft by ID.
 * @param {string} draftId
 * @param {Object} data
 * @returns {Promise<Object>} The updated draft
 */
export async function updateDraft(draftId, data) {
  return prisma.orderDraft.update({
    where: { id: draftId },
    data,
  });
}

/**
 * Finalize a draft: create an order, delete the draft.
 * @param {string} draftId
 * @param {Object} orderData
 * @returns {Promise<Object>} The created order
 */
export async function finalizeDraft(draftId, orderData) {
  const draft = await prisma.orderDraft.findUnique({ where: { id: draftId } });
  if (!draft) throw new Error('Draft not found');
  // Create the order
  const order = await prisma.order.create({
    data: orderData,
  });
  // Delete the draft
  await prisma.orderDraft.delete({ where: { id: draftId } });
  return order;
}

/**
 * Delete a draft by ID.
 * @param {string} draftId
 * @returns {Promise<void>}
 */
export async function deleteDraft(draftId) {
  await prisma.orderDraft.delete({ where: { id: draftId } });
}

/**
 * Get the current draft for a conversation.
 * @param {string} conversationId
 * @returns {Promise<Object|null>}
 */
export async function getDraftByConversationId(conversationId) {
  return prisma.orderDraft.findFirst({
    where: { conversationId, status: 'IN_PROGRESS' },
  });
} 