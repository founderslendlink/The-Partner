/**
 * ENVIRONMENT CONTEXT
 *
 * Extends context builder with real-world situational awareness.
 * Added to buildContext() output as context.environment
 *
 * Provides: current_time, timezone, day_of_week, hour_of_day,
 *           workload_level, urgency, calendar_state
 *
 * Used by: decision engine, scheduling logic, follow-up timing
 */

const { db } = require('../utils/supabase');

/**
 * Build environment context for a business.
 * Called inside buildContext() — non-blocking, fast.
 */
async function buildEnvironmentContext(businessId, timezone) {
  const tz = timezone || process.env.DEFAULT_TIMEZONE || 'America/Chicago';

  // Current time in business timezone
  const now = new Date();
  const localTime = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'long',
    hour12: false,
  }).formatToParts(now);

  const hour    = parseInt(localTime.find(p => p.type === 'hour')?.value || '12');
  const weekday = localTime.find(p => p.type === 'weekday')?.value || 'Monday';
  const minute  = parseInt(localTime.find(p => p.type === 'minute')?.value || '0');

  // Workload level based on pending items
  const supabase = db();

  const [{ count: pendingActions }, { count: overdueTasksCount }, { count: approvalCount }] =
    await Promise.all([
      supabase.from('action_queue').select('id', { count: 'exact', head: true })
        .eq('business_id', businessId).eq('status', 'pending'),
      supabase.from('tasks').select('id', { count: 'exact', head: true })
        .eq('business_id', businessId).eq('status', 'overdue'),
      supabase.from('action_queue').select('id', { count: 'exact', head: true })
        .eq('business_id', businessId).eq('status', 'approval_required'),
    ]);

  const totalLoad = (pendingActions || 0) + (overdueTasksCount || 0) * 2 + (approvalCount || 0);
  const workloadLevel =
    totalLoad > 30 ? 'critical' :
    totalLoad > 15 ? 'high' :
    totalLoad > 5  ? 'medium' : 'low';

  // Urgency based on time of day + day of week
  const isBusinessHours = hour >= 8 && hour < 18;
  const isWeekend       = weekday === 'Saturday' || weekday === 'Sunday';
  const isEndOfDay      = hour >= 16;
  const isMorning       = hour >= 7 && hour < 10;

  const urgency =
    (workloadLevel === 'critical' || (isBusinessHours && overdueTasksCount > 3)) ? 'urgent' :
    (isBusinessHours && !isWeekend) ? 'normal' :
    isEndOfDay ? 'high' : 'low';

  // Time-based scheduling advice
  const schedulingAdvice = getSchedulingAdvice(hour, weekday, isWeekend);

  const environment = {
    current_time:      now.toISOString(),
    local_time:        `${hour}:${String(minute).padStart(2, '0')}`,
    timezone:          tz,
    day_of_week:       weekday,
    hour_of_day:       hour,
    is_business_hours: isBusinessHours,
    is_weekend:        isWeekend,
    is_morning:        isMorning,
    is_end_of_day:     isEndOfDay,
    workload_level:    workloadLevel,
    urgency,
    pending_actions:   pendingActions || 0,
    overdue_tasks:     overdueTasksCount || 0,
    pending_approvals: approvalCount || 0,
    scheduling_advice: schedulingAdvice,
    calendar_state:    {}, // Populated when calendar integration is connected
  };

  // Persist snapshot for decision audit trail
  try {
    await supabase.from('environment_snapshots').insert({
      business_id:   businessId,
      current_time:  now.toISOString(),
      timezone:      tz,
      day_of_week:   weekday,
      hour_of_day:   hour,
      workload_level: workloadLevel,
      urgency,
      calendar_state: {},
    });
  } catch (e) {}

  return environment;
}

/**
 * Get scheduling advice string for use in agent prompts.
 * Tells the AI when to schedule follow-ups, reminders, etc.
 */
function getSchedulingAdvice(hour, weekday, isWeekend) {
  if (isWeekend) {
    return 'It is the weekend. Schedule any outbound messages for Monday morning 9am unless urgent.';
  }
  if (hour < 7) {
    return 'Very early morning. Queue messages to send at 9am business hours.';
  }
  if (hour >= 7 && hour < 10) {
    return 'Morning — excellent time for outreach. Leads are responsive now.';
  }
  if (hour >= 10 && hour < 12) {
    return 'Mid-morning — good time for follow-ups and calls.';
  }
  if (hour >= 12 && hour < 14) {
    return 'Lunch hour — lower response rates. Schedule follow-ups for 2-4pm.';
  }
  if (hour >= 14 && hour < 17) {
    return 'Afternoon — solid window for outreach and proposals.';
  }
  if (hour >= 17 && hour < 20) {
    return 'Evening — schedule for tomorrow morning unless the lead is clearly active now.';
  }
  return 'After hours. Queue for next business morning.';
}

module.exports = { buildEnvironmentContext };
