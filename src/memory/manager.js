const { db } = require('../utils/supabase');
const { createEmbedding } = require('../utils/ai');
const { logger } = require('../utils/logger');
const { postToDiscord } = require('../discord/poster');

/**
 * Write a new memory entry (Tier 2) and queue its embedding (Tier 3).
 */
async function writeMemory(businessId, { type, content, importance = 5, source = 'system', tags = [], entityType, entityId, expiresAt }) {
  const supabase = db();

  const { data: entry, error } = await supabase
    .from('memory_entries')
    .insert({
      business_id: businessId,
      type,
      content,
      importance,
      source,
      expires_at: expiresAt || null,
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to write memory entry:', error.message);
    return null;
  }

  // Write tags
  if (tags.length > 0) {
    await supabase.from('memory_tags').insert(
      tags.map(tag => ({ memory_id: entry.id, tag }))
    );
  }

  // Entity tag
  if (entityType && entityId) {
    await supabase.from('memory_tags').insert({
      memory_id: entry.id,
      tag: `${entityType}:${entityId}`,
      entity_type: entityType,
      entity_id: entityId,
    });
  }

  // Generate and store embedding asynchronously (non-blocking)
  embedMemoryAsync(entry.id, content);

  await postToDiscord(businessId, 'memory',
    `🧠 **Memory written** [${type}] (importance: ${importance})\n${content.slice(0, 200)}`
  ).catch(() => {});

  return entry;
}

/**
 * Write multiple memory updates from an agent response.
 */
async function writeMemoryUpdates(businessId, memoryUpdates) {
  if (!memoryUpdates || memoryUpdates.length === 0) return;
  for (const update of memoryUpdates) {
    await writeMemory(businessId, update).catch(err =>
      logger.warn('Memory write failed (non-fatal):', err.message)
    );
  }
}

/**
 * Generate embedding and store in memory_vectors.
 * Called asynchronously — does not block the main flow.
 */
async function embedMemoryAsync(memoryId, content) {
  try {
    const embedding = await createEmbedding(content);
    const supabase = db();
    await supabase.from('memory_vectors').insert({
      memory_id: memoryId,
      embedding,
      model: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
    });
  } catch (err) {
    logger.warn(`Embedding failed for memory ${memoryId} (non-fatal):`, err.message);
  }
}

/**
 * Prune stale low-importance memories.
 * Run weekly via the scheduled_jobs system.
 */
async function pruneMemories(businessId) {
  const supabase = db();
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Remove expired entries
  const { data: expired } = await supabase
    .from('memory_entries')
    .delete()
    .eq('business_id', businessId)
    .lt('expires_at', new Date().toISOString())
    .select('id');

  // Remove old low-importance entries
  const { data: stale } = await supabase
    .from('memory_entries')
    .delete()
    .eq('business_id', businessId)
    .lt('importance', 4)
    .lt('created_at', cutoff)
    .select('id');

  const pruned = (expired?.length || 0) + (stale?.length || 0);
  logger.info(`Memory pruning: removed ${pruned} entries for business ${businessId}`);
  return pruned;
}

module.exports = { writeMemory, writeMemoryUpdates, pruneMemories };
